import type { Address } from "@solana/kit";
import { addressBytes, concatBytes, utf8 } from "../beta/bytes.js";
import { betaError } from "../beta/errors.js";
import { getProgramDerivedAddressCached } from "../beta/pdaMemo.js";
import type { MimirBetaInstruction, MimirBetaInstructionAccount } from "../beta/types.js";
import { canonicalizeMimirBetaTicker, deriveMimirBetaClassicFeedId, deriveMimirBetaCompositeFeedId, encodeMimirBetaTicker } from "../beta/abi.js";
import { assertMimirClassicConverterAdmitted, encodeMimirFusedClassicData, type MimirFusedClassicRequest } from "../beta/classicExecution.js";
import { encodeMimirFusedRefreshData, MIMIR_INSTRUCTIONS_SYSVAR_ID, type MimirFusedRefreshRequest } from "../beta/compositeExecution.js";
import { MIMIR_BETA_SYSTEM_PROGRAM_ID } from "../beta/deployment.js";
import type { V1Descriptor } from "./decoders.js";

/** V1 mainnet program id (public); builders take the id from config. */
export const MIMIR_V1_MAINNET_PROGRAM_ID = "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR" as Address;
export const MIMIR_V1_SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
export const MIMIR_V1_ATA_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address;
export const MIMIR_V1_MPL_CORE_PROGRAM_ID = "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d" as Address;

export const MIMIR_V1_TAG = Object.freeze({
  CLAIM_REFRESH_FEES: 63, REFRESH_FUSED_COMPOSITE: 87, REFRESH_FUSED_CLASSIC: 89, RECLAIM_EXCESS_RENT: 91,
  CREATE_CLASSIC: 93, GROW_CONSTRUCTING: 94, CREATE_COMPOSITE: 95, TRANSFER_FEED: 96, INIT_GENERATION_COUNTER: 103,
} as const);
export const MIMIR_V1_WIRE_VERSION = 1;
export const MIMIR_V1_CREATE_MODE = Object.freeze({ SINGLE: 0, BEGIN: 1, SEAL: 2 } as const);
export type MimirV1CreateMode = typeof MIMIR_V1_CREATE_MODE[keyof typeof MIMIR_V1_CREATE_MODE];
/** Largest account one ix can create or grow by (MAX_PERMITTED_DATA_INCREASE). */
export const MIMIR_V1_MAX_CREATE_LEN = 10_240;

export const MIMIR_V1_FEED_IMAGE_LEN = 325;
export const MIMIR_V1_PLAN_IMAGE_LEN = 320;
export const MIMIR_V1_DESCRIPTOR_LEN = 16;
export const MIMIR_V1_SOURCE_IMAGE_LEN = 384;
const CLASSIC_ROWS_START = 1_558;
const SOURCE_ROW_LEN = 944;
const CONVERTER_FIXED_LEN = 1_797;

const SEED = Object.freeze({
  feed: utf8("feed_snapshot"), composite: utf8("composite_snapshot"), ticker: utf8("ticker"), generation: utf8("generation"),
  identity: utf8("identity_claim"), admin: utf8("admin_config"), registry: utf8("mimir_registry"), treasury: utf8("protocol_treasury"),
  sourceConfig: utf8("source_config"), oneChar: utf8("one-char"),
});
const u16le = (v: number) => Uint8Array.of(v & 0xff, v >> 8);
const u32le = (v: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); return b; };
const u64le = (v: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, v, true); return b; };
const w = (address: Address, isSigner = false): MimirBetaInstructionAccount => ({ address, isSigner, isWritable: true });
const r = (address: Address, isSigner = false): MimirBetaInstructionAccount => ({ address, isSigner, isWritable: false });
const ix = (programId: Address, accounts: MimirBetaInstructionAccount[], data: Uint8Array): MimirBetaInstruction =>
  ({ programAddress: programId, accounts, data });

// ---- PDAs (docs/LAYOUT_V1_CLASSIC.md §2.1) ----
type Pda = Promise<readonly [Address, number]>;
const pda = (programId: Address, ...seeds: Uint8Array[]): Pda => getProgramDerivedAddressCached(programId, seeds);
export const findMimirV1ClassicFeedPda = (programId: Address, feedId: Address): Pda => pda(programId, SEED.feed, addressBytes(feedId));
export const findMimirV1CompositePda = (programId: Address, feedId: Address): Pda => pda(programId, SEED.composite, addressBytes(feedId));
export function findMimirV1TickerClaimPda(programId: Address, ticker: string): Pda {
  if (!/^[A-Z0-9]{1,12}$/.test(ticker)) betaError("INVALID_ARGUMENT", "V1 ticker must be 1-12 uppercase ASCII");
  return pda(programId, SEED.ticker, utf8(ticker));
}
export const findMimirV1GenerationCounterPda = (programId: Address): Pda => pda(programId, SEED.generation);
export const findMimirV1IdentityClaimPda = (programId: Address, asset: Address): Pda => pda(programId, SEED.identity, addressBytes(asset));
export const findMimirV1AdminConfigPda = (programId: Address): Pda => pda(programId, SEED.admin, u16le(1));
export const findMimirV1RegistryPda = (programId: Address): Pda => pda(programId, SEED.registry, u16le(0));
export const findMimirV1TreasuryPda = (programId: Address): Pda => pda(programId, SEED.treasury, u16le(1));
/** R-08 address rule: the canonical would-be SourceConfig PDA, never materialised. */
export const findMimirV1SourceConfigAddress = (programId: Address, feedId: Address, index: number): Pda =>
  pda(programId, SEED.sourceConfig, addressBytes(feedId), Uint8Array.of(index));
export const findMimirV1OneCharAllowancePda = (programId: Address, wallet: Address): Pda => pda(programId, SEED.oneChar, addressBytes(wallet));
export const findMimirV1AssociatedTokenAddress = (owner: Address, mint: Address): Pda =>
  pda(MIMIR_V1_ATA_PROGRAM_ID, addressBytes(owner), addressBytes(MIMIR_V1_SPL_TOKEN_PROGRAM_ID), addressBytes(mint));

/** CORE feed_id (S-6): v1 mint-pair rule; variant 0 is admin-only on chain. */
export const deriveMimirV1ClassicFeedId = deriveMimirBetaClassicFeedId;

/**
 * First variant ≥ 1 whose feed PDA is not owned by the Mimir program (user creations; variant 0 is the admin's). A pre-funded
 * System-owned PDA is still free. One batched read; `accountOwners` returns each owner or null (a zero-length `dataSlice` suffices).
 */
export async function findMimirV1FreeClassicVariant(a: Readonly<{
  programId: Address; baseMint: Address; quoteMint: Address; accountOwners: (addresses: readonly Address[]) => Promise<readonly (Address | null)[]>; maxVariant?: number;
}>): Promise<Readonly<{ variant: number; feedId: Address; feed: Address; feedBump: number }>> {
  const variants = Array.from({ length: a.maxVariant ?? 16 }, (_, i) => i + 1);
  const ids = await Promise.all(variants.map((v) => deriveMimirV1ClassicFeedId(a.baseMint, a.quoteMint, v)));
  const pdas = await Promise.all(ids.map((id) => findMimirV1ClassicFeedPda(a.programId, id)));
  const owners = await a.accountOwners(pdas.map(([x]) => x));
  const i = owners.findIndex((x) => x !== a.programId);
  if (i < 0 || owners.length !== pdas.length) return betaError("VARIANT_UNAVAILABLE", "no free V1 Classic variant in range");
  return { variant: variants[i]!, feedId: ids[i]!, feed: pdas[i]![0], feedBump: pdas[i]![1] };
}
/** Composite feed_id: v1 rule over the R-08 SourceConfig addresses under the V1 program id. */
export const deriveMimirV1CompositeFeedId = deriveMimirBetaCompositeFeedId;

/**
 * COLA amount raw CREATE_CLASSIC / CREATE_COMPOSITE require (v1 checked_ticker_tariff): 1 char 0, else base × AdminConfig tenths / 10,
 * exact and u64; base 0 refused.
 */
export function computeMimirV1TickerTariff(baseAmountRaw: bigint, ticker: string, tickerTierTenths: readonly number[]): bigint {
  const length = canonicalizeMimirBetaTicker(ticker).length;
  if (typeof baseAmountRaw !== "bigint" || baseAmountRaw <= 0n || baseAmountRaw >= 1n << 64n) betaError("INVALID_ARGUMENT", "V1 ticker tariff base must be a nonzero u64");
  if (tickerTierTenths.length !== 4 || tickerTierTenths.some((t) => !Number.isInteger(t) || t < 0 || t > 255)) betaError("INVALID_ARGUMENT", "V1 ticker tiers must be four u8");
  if (length === 1) return 0n;
  const scaled = baseAmountRaw * BigInt(tickerTierTenths[Math.min(length, 5) - 2]!);
  if (scaled % 10n !== 0n || scaled / 10n >= 1n << 64n) betaError("INVALID_ARGUMENT", "V1 ticker tariff is not an exact u64");
  return scaled / 10n;
}

/**
 * CREATE_COMPOSITE activation lamports from AdminConfig: the owner fee per `ownerPaidComponents` (foreign owner wallets paid; default all),
 * the treasury fee per component not covered by one of `credits` consumed F2 credits, the per-creation treasury fee, and the owner fee of
 * each `redirectedComponents` (OWNERLESS or undeliverable owner) redirected to the treasury.
 */
export function computeMimirV1CompositeActivationFeeLamports(admin: Readonly<{
  compositeActivationOwnerFeeLamports: bigint; compositeActivationTreasuryComponentFeeLamports: bigint; compositeActivationTreasuryCreationFeeLamports: bigint;
}>, components: number, ownerPaidComponents = components, credits = 0, redirectedComponents = 0): Readonly<{ owners: bigint; treasury: bigint; total: bigint }> {
  const count = (v: number, max: number) => Number.isInteger(v) && v >= 0 && v <= max;
  if (!Number.isInteger(components) || components < 2 || components > 5 || !count(credits, components)
    || !count(ownerPaidComponents, components) || !count(redirectedComponents, components - ownerPaidComponents)) {
    betaError("INVALID_ARGUMENT", "V1 composite activation needs 2-5 components and counts within them");
  }
  const owners = admin.compositeActivationOwnerFeeLamports * BigInt(ownerPaidComponents);
  const treasury = admin.compositeActivationTreasuryComponentFeeLamports * BigInt(components - credits) + admin.compositeActivationTreasuryCreationFeeLamports
    + admin.compositeActivationOwnerFeeLamports * BigInt(redirectedComponents);
  return { owners, treasury, total: owners + treasury };
}

// ---- Classic exact length (LAYOUT_V1_CLASSIC §1, §1.4) ----
/** Membership + module bytes a row adds after `rows_end`, from its 16-B descriptor. */
function rowTailLen(descriptor: Uint8Array): number {
  if (descriptor.length !== MIMIR_V1_DESCRIPTOR_LEN) betaError("INVALID_ARGUMENT", "V1 descriptor must be 16 bytes");
  const derived = (descriptor[15]! & 2) !== 0;
  return (derived ? 4 : 4 + 65 * descriptor[14]!) + (descriptor[8]! | descriptor[9]! << 8);
}

export function mimirV1ClassicExactLen(primaryDescriptors: readonly Uint8Array[], converterDescriptors: readonly Uint8Array[] = []): number {
  const n = primaryDescriptors.length; const s = converterDescriptors.length;
  if (n < 1 || n > 5 || s > 5) betaError("INVALID_ARGUMENT", "V1 Classic needs 1-5 primary and 0-5 converter rows");
  const rowsEnd = CLASSIC_ROWS_START + SOURCE_ROW_LEN * n + (s === 0 ? 0 : CONVERTER_FIXED_LEN + SOURCE_ROW_LEN * s);
  return [...primaryDescriptors, ...converterDescriptors].reduce((len, d) => len + rowTailLen(d), rowsEnd);
}

// ---- 93 CREATE_CLASSIC / 95 CREATE_COMPOSITE / 94 GROW_CONSTRUCTING (docs/V1_WIRE.md §2.1-2.3) ----
/** `[0..8)` shared by every CREATE mode: tag, version, mode, n|N, s, target bump, ticker-claim bump, counter bump. */
export interface MimirV1CreateHead {
  readonly n: number; readonly s: number;
  readonly targetBump: number; readonly tickerBump: number; readonly counterBump: number;
}

const byte = (v: number, min: number, max: number, label: string) => {
  if (!Number.isInteger(v) || v < min || v > max) betaError("INVALID_ARGUMENT", `V1 CREATE ${label} out of range`);
  return v;
};

function createHead(tag: 93 | 95, mode: MimirV1CreateMode, h: MimirV1CreateHead): Uint8Array {
  return Uint8Array.of(tag, MIMIR_V1_WIRE_VERSION, mode, byte(h.n, tag === 93 ? 1 : 2, 5, "n"), byte(h.s, 0, 5, "s"),
    byte(h.targetBump, 0, 255, "target bump"), byte(h.tickerBump, 0, 255, "ticker bump"), byte(h.counterBump, 0, 255, "counter bump"));
}

/** `computeMimirV1TickerTariff(admin base, ticker, admin tiers)`: 0 for a 1-char ticker (the one-char allowance pays instead). */
function colaAmount(v: bigint, oneChar: boolean): Uint8Array {
  if (v < 0n || v >= 1n << 64n || (oneChar && v !== 0n)) betaError("INVALID_ARGUMENT", "V1 COLA amount must be the ticker tariff (0 for a 1-char ticker)");
  return u64le(v);
}

/** BEGIN (both kinds): `[0..8)` with mode 1 ‖ target_len u32 (> 10,240) ‖ feed_id. 44 B. */
export function encodeMimirV1CreateBeginData(tag: 93 | 95, head: MimirV1CreateHead, targetLen: number, feedId: Address): Uint8Array {
  if (!Number.isInteger(targetLen) || targetLen <= MIMIR_V1_MAX_CREATE_LEN || targetLen > 0xffff_ffff) betaError("INVALID_ARGUMENT", "V1 BEGIN target length must exceed 10,240");
  return concatBytes(createHead(tag, MIMIR_V1_CREATE_MODE.BEGIN, head), u32le(targetLen), addressBytes(feedId));
}

export function encodeMimirV1GrowData(newLen: number): Uint8Array {
  if (!Number.isInteger(newLen) || newLen <= MIMIR_V1_MAX_CREATE_LEN || newLen > 0xffff_ffff) betaError("INVALID_ARGUMENT", "V1 GROW length out of range");
  return concatBytes(Uint8Array.of(MIMIR_V1_TAG.GROW_CONSTRUCTING, MIMIR_V1_WIRE_VERSION), u32le(newLen));
}

/** V0 feed image ticker @313, v1 codec: a 1-11 length byte, or 12 raw ASCII bytes. */
const FEED_IMAGE_TICKER = 313;

type SingleOrSeal = typeof MIMIR_V1_CREATE_MODE.SINGLE | typeof MIMIR_V1_CREATE_MODE.SEAL;

export interface MimirV1ClassicDefinition {
  readonly feedImage: Uint8Array;
  readonly planImage: Uint8Array;
  readonly rows: readonly Readonly<{ descriptor: Uint8Array; sourceImage: Uint8Array }>[];
  /** feed_id variant (S-6); 0 is admin-only on chain. */
  readonly variant: number;
}

/** Single / seal: head ‖ COLA u64 ‖ feed image 325 ‖ plan 320 ‖ n × (descriptor 16 ‖ source 384) ‖ variant u16. `663 + 400n` B. */
export function encodeMimirV1CreateClassicData(mode: SingleOrSeal, head: MimirV1CreateHead, colaAmountRaw: bigint, def: MimirV1ClassicDefinition): Uint8Array {
  if (def.feedImage.length !== MIMIR_V1_FEED_IMAGE_LEN || def.planImage.length !== MIMIR_V1_PLAN_IMAGE_LEN ||
      def.rows.length !== head.n || def.rows.some((x) => x.descriptor.length !== MIMIR_V1_DESCRIPTOR_LEN || x.sourceImage.length !== MIMIR_V1_SOURCE_IMAGE_LEN)) {
    betaError("INVALID_ARGUMENT", "V1 Classic definition does not match the frozen wire");
  }
  return concatBytes(createHead(93, mode, head), colaAmount(colaAmountRaw, def.feedImage[FEED_IMAGE_TICKER] === 1), def.feedImage, def.planImage,
    ...def.rows.flatMap((x) => [x.descriptor, x.sourceImage]), u16le(byte(def.variant, 0, 0xffff, "variant")));
}

export interface MimirV1CompositeParams {
  readonly priceExponent: number; readonly riskTier: number; readonly routeabilityCap: number;
  readonly maxSnapshotAgeSlots: number; readonly maxComponentSnapshotAgeSlots: number;
  readonly maxComponentConfidenceBps: number; readonly maxComponentDispersionBps: number;
  readonly ticker: string; readonly quoteMint: Address;
  /** Per component: quantity and which optional metas follow the child (bit0 owner destination, bit1 Core asset). */
  readonly components: readonly Readonly<{ quantityX64: bigint; ownerDestination: boolean; coreAsset: boolean }>[];
}

/**
 * Single / seal: head ‖ COLA u64 ‖ exponent i32 ‖ risk ‖ cap ‖ 4 × u16 ‖ ticker 12 ‖ quote 32 ‖ expected AdminConfig revision u64 ‖
 * N × (quantity u128 ‖ flags). `82 + 17N` B. A revision other than AdminConfig.config_revision is CreationAmountMismatch (99).
 */
/** Program `mantissa_domain_is_feasible`: some positive component prices publish at `exponent` (CREATE_COMPOSITE otherwise InvalidExponent). */
export function mimirV1CompositeMantissaDomainFeasible(quantitiesX64: readonly bigint[], exponent: number): boolean {
  const max = (1n << 128n) - 1n; let low = 0n, high = 0n;
  for (const q of quantitiesX64) { const whole = q >> 64n; low += whole > 1n ? whole : 1n; high += whole === 0n ? (q << 64n) - 1n : max; }
  const scale = 10n ** BigInt(Math.abs(exponent));
  return exponent >= 0 ? (high > max ? max : high) >> 64n >= scale : low * scale <= max;
}

export function encodeMimirV1CreateCompositeData(mode: SingleOrSeal, head: MimirV1CreateHead, colaAmountRaw: bigint, expectedAdminConfigRevision: bigint,
  p: MimirV1CompositeParams): Uint8Array {
  if (p.components.length !== head.n) betaError("INVALID_ARGUMENT", "V1 composite components must match N");
  if (typeof expectedAdminConfigRevision !== "bigint" || expectedAdminConfigRevision < 0n || expectedAdminConfigRevision >= 1n << 64n) {
    betaError("INVALID_ARGUMENT", "V1 expected AdminConfig revision must be a u64");
  }
  if (!/^[A-Z0-9]{1,12}$/.test(p.ticker)) betaError("INVALID_ARGUMENT", "V1 ticker must be 1-12 uppercase ASCII");
  if (!Number.isInteger(p.priceExponent) || p.priceExponent < -36 || p.priceExponent > 19) betaError("INVALID_ARGUMENT", "V1 composite price exponent out of range");
  if (p.components.every((c) => c.quantityX64 > 0n && c.quantityX64 < 1n << 128n) &&
      !mimirV1CompositeMantissaDomainFeasible(p.components.map((c) => c.quantityX64), p.priceExponent)) {
    betaError("INVALID_ARGUMENT", "V1 composite quantities and price exponent admit no representable price (InvalidExponent)");
  }
  const exponent = new Uint8Array(4); new DataView(exponent.buffer).setInt32(0, p.priceExponent, true);
  return concatBytes(createHead(95, mode, head), colaAmount(colaAmountRaw, p.ticker.length === 1), exponent,
    Uint8Array.of(byte(p.riskTier, 0, 255, "risk tier"), byte(p.routeabilityCap, 0, 255, "routeability cap")),
    ...[p.maxSnapshotAgeSlots, p.maxComponentSnapshotAgeSlots, p.maxComponentConfidenceBps, p.maxComponentDispersionBps].map((v) => u16le(byte(v, 0, 0xffff, "policy"))),
    encodeMimirBetaTicker(p.ticker), addressBytes(p.quoteMint), u64le(expectedAdminConfigRevision),
    ...p.components.flatMap((c) => {
      if (c.quantityX64 <= 0n || c.quantityX64 >= 1n << 128n) betaError("INVALID_ARGUMENT", "V1 component quantity out of range");
      const q = new Uint8Array(16); new DataView(q.buffer).setBigUint64(0, c.quantityX64 & 0xffff_ffff_ffff_ffffn, true);
      new DataView(q.buffer).setBigUint64(8, c.quantityX64 >> 64n, true);
      return [q, Uint8Array.of((c.ownerDestination ? 1 : 0) | (c.coreAsset ? 2 : 0))];
    }));
}

export interface MimirV1CreateCommonAccounts {
  readonly programId: Address; readonly payer: Address; readonly tickerClaim: Address; readonly generationCounter: Address;
  readonly adminConfig: Address; readonly registry: Address; readonly colaMint: Address; readonly payerColaAta: Address;
  /** Required iff s ≥ 1. */
  readonly solFeed?: Address;
  /** v1 one-char allowance `["one-char", payer]`, required iff the ticker is 1 char; the very last meta (P2/P4c). */
  readonly oneCharAllowance?: Address;
}

export interface MimirV1CreateClassicAccounts extends MimirV1CreateCommonAccounts {
  readonly feed: Address;
  /** Per primary row, its `external_width` vector accounts in row order. */
  readonly sourceAccounts: readonly (readonly Address[])[];
  /** CREATE-only: the canonical Oracle of each adaptive Orca primary row, row order; after the source groups, before SOL / sysvar / allowance. */
  readonly orcaAdmissionOracles?: readonly Address[];
}

export interface MimirV1CreateCompositeAccounts extends MimirV1CreateCommonAccounts {
  readonly composite: Address; readonly treasury: Address;
  /** Per component, in data order; `ownerDestination` / `coreAsset` present iff the data flags say so. */
  readonly children: readonly Readonly<{ feed: Address; f2CreditConsumed?: boolean; ownerDestination?: Address; coreAsset?: Address }>[];
}

const solFeedMeta = (a: MimirV1CreateCommonAccounts, s: number) => {
  if ((s > 0) !== (a.solFeed !== undefined)) betaError("INVALID_ARGUMENT", "V1 SOL feed account is required iff s ≥ 1");
  return a.solFeed ? [r(a.solFeed)] : [];
};
const sealSysvar = (mode: SingleOrSeal) => mode === MIMIR_V1_CREATE_MODE.SEAL ? [r(MIMIR_INSTRUCTIONS_SYSVAR_ID)] : [];
const oneCharMeta = (a: MimirV1CreateCommonAccounts, oneChar: boolean) => {
  if (oneChar !== (a.oneCharAllowance !== undefined)) betaError("ONE_CHAR_ALLOWANCE_REQUIRED", "V1 one-char allowance account is required iff the ticker is 1 char");
  return a.oneCharAllowance ? [w(a.oneCharAllowance)] : [];
};
export function buildMimirV1CreateClassicInstruction(a: MimirV1CreateClassicAccounts & Readonly<{
  mode: SingleOrSeal; head: MimirV1CreateHead; colaAmountRaw: bigint; definition: MimirV1ClassicDefinition;
}>): MimirBetaInstruction {
  if (a.sourceAccounts.length !== a.head.n) betaError("INVALID_ARGUMENT", "V1 source vectors must match n");
  return ix(a.programId, [w(a.payer, true), w(a.feed), w(a.tickerClaim), w(a.generationCounter), r(a.adminConfig), r(a.registry),
    w(a.colaMint), w(a.payerColaAta), r(MIMIR_V1_SPL_TOKEN_PROGRAM_ID), r(MIMIR_BETA_SYSTEM_PROGRAM_ID),
    ...a.sourceAccounts.flat().map((x) => r(x)), ...(a.orcaAdmissionOracles ?? []).map((x) => r(x)), ...solFeedMeta(a, a.head.s), ...sealSysvar(a.mode),
    ...oneCharMeta(a, a.definition.feedImage[FEED_IMAGE_TICKER] === 1)],
  encodeMimirV1CreateClassicData(a.mode, a.head, a.colaAmountRaw, a.definition));
}

export function buildMimirV1CreateCompositeInstruction(a: MimirV1CreateCompositeAccounts & Readonly<{
  mode: SingleOrSeal; head: MimirV1CreateHead; colaAmountRaw: bigint; expectedAdminConfigRevision: bigint; params: MimirV1CompositeParams;
}>): MimirBetaInstruction {
  if (a.children.length !== a.head.n || a.children.some((c, i) =>
    (c.ownerDestination !== undefined) !== a.params.components[i]!.ownerDestination || (c.coreAsset !== undefined) !== a.params.components[i]!.coreAsset)) {
    betaError("INVALID_ARGUMENT", "V1 composite child metas must match the data flags");
  }
  return ix(a.programId, [w(a.payer, true), w(a.composite), w(a.tickerClaim), w(a.generationCounter), r(a.adminConfig), r(a.registry),
    w(a.treasury), w(a.colaMint), w(a.payerColaAta), r(MIMIR_V1_SPL_TOKEN_PROGRAM_ID), r(MIMIR_BETA_SYSTEM_PROGRAM_ID),
    ...a.children.flatMap((c) => [c.f2CreditConsumed ? w(c.feed) : r(c.feed), ...(c.ownerDestination ? [w(c.ownerDestination)] : []), ...(c.coreAsset ? [r(c.coreAsset)] : [])]),
    ...solFeedMeta(a, a.head.s), ...sealSysvar(a.mode), ...oneCharMeta(a, a.params.ticker.length === 1)],
  encodeMimirV1CreateCompositeData(a.mode, a.head, a.colaAmountRaw, a.expectedAdminConfigRevision, a.params));
}

/** BEGIN: payer(s,w), target(w), admin_config, registry, System, instructions sysvar. */
export function buildMimirV1CreateBeginInstruction(a: Readonly<{
  tag: 93 | 95; programId: Address; payer: Address; target: Address; adminConfig: Address; registry: Address;
  head: MimirV1CreateHead; targetLen: number; feedId: Address;
}>): MimirBetaInstruction {
  return ix(a.programId, [w(a.payer, true), w(a.target), r(a.adminConfig), r(a.registry), r(MIMIR_BETA_SYSTEM_PROGRAM_ID), r(MIMIR_INSTRUCTIONS_SYSVAR_ID)],
    encodeMimirV1CreateBeginData(a.tag, a.head, a.targetLen, a.feedId));
}

/** GROW: payer(s,w), feed or composite(w), System, instructions sysvar. */
export function buildMimirV1GrowInstruction(a: Readonly<{ programId: Address; payer: Address; target: Address; newLen: number }>): MimirBetaInstruction {
  return ix(a.programId, [w(a.payer, true), w(a.target), r(MIMIR_BETA_SYSTEM_PROGRAM_ID), r(MIMIR_INSTRUCTIONS_SYSVAR_ID)], encodeMimirV1GrowData(a.newLen));
}

// ---- 96-103, V1 63/91 (docs/V1_WIRE.md §2.4-2.13) ----
const tagOnly = (tag: number, ...rest: number[]) => Uint8Array.of(tag, MIMIR_V1_WIRE_VERSION, ...rest);

export function buildMimirV1TransferFeedInstruction(a: Readonly<{
  programId: Address; creator: Address; target: Address; identityClaim: Address; identityClaimBump: number; asset: Address;
  agent: Address; rootConfig: Address; collection: Address;
}>): MimirBetaInstruction {
  return ix(a.programId, [w(a.creator, true), w(a.target), w(a.identityClaim), r(a.asset), r(a.agent), r(a.rootConfig), r(a.collection),
    r(MIMIR_V1_MPL_CORE_PROGRAM_ID), r(MIMIR_BETA_SYSTEM_PROGRAM_ID)], tagOnly(MIMIR_V1_TAG.TRANSFER_FEED, byte(a.identityClaimBump, 0, 255, "identity bump")));
}

export const MIMIR_V1_NOTICE_KIND = Object.freeze({ DISCRETIONARY: 1, ABANDONED: 2 } as const);
export function buildMimirV1InitGenerationCounterInstruction(a: Readonly<{ programId: Address; admin: Address; adminConfig: Address; counter: Address }>): MimirBetaInstruction {
  return ix(a.programId, [w(a.admin, true), r(a.adminConfig), w(a.counter), r(MIMIR_BETA_SYSTEM_PROGRAM_ID)], tagOnly(MIMIR_V1_TAG.INIT_GENERATION_COUNTER));
}
/** V1 tag63: `[63] ‖ expected_owner_claimed u64 ‖ amount u64`; destination = the resolved payee (owner or treasury). */
export function buildMimirV1ClaimRefreshFeesInstruction(a: Readonly<{
  programId: Address; composite: Address; destination: Address; asset?: Address; expectedOwnerClaimed: bigint; amount: bigint;
}>): MimirBetaInstruction {
  if (a.amount <= 0n || a.amount >= 1n << 64n || a.expectedOwnerClaimed < 0n || a.expectedOwnerClaimed >= 1n << 64n) betaError("INVALID_ARGUMENT", "V1 claim amount out of range");
  return ix(a.programId, [w(a.composite), w(a.destination), ...(a.asset ? [r(a.asset)] : [])],
    concatBytes(Uint8Array.of(MIMIR_V1_TAG.CLAIM_REFRESH_FEES), u64le(a.expectedOwnerClaimed), u64le(a.amount)));
}
/** V1 tag91 `[91]`: target, creator, and the owning feed/composite when the target is a ticker claim. */
export function buildMimirV1ReclaimExcessRentInstruction(a: Readonly<{ programId: Address; target: Address; creator: Address; tickerClaimOwner?: Address }>): MimirBetaInstruction {
  return ix(a.programId, [w(a.target), w(a.creator), ...(a.tickerClaimOwner ? [r(a.tickerClaimOwner)] : [])], Uint8Array.of(MIMIR_V1_TAG.RECLAIM_EXCESS_RENT));
}

// ---- tag89 / tag87 refresh metas on the V1 accounts (SPEC §4.4; data as 9bea223) ----
/** The decoded V1 feed (`decodeV1ClassicFeed` / `decodeV1CompositeFeed`): primary rows, then converter rows. */
export type MimirV1RefreshRows = Readonly<{ rows: readonly Readonly<{ descriptor: V1Descriptor }>[]; converter: Readonly<{ rows: readonly Readonly<{ descriptor: V1Descriptor }>[] }> | null }>;

/**
 * Window of an already-admitted direct DLMM recipe (program `families.rs`), the only rows that accept up to two row-local canonical
 * neighbour bin arrays after their sealed `externalWidth` base: visible spot / native `legacy`, compact `point`, `dual` (native when
 * ready and within the confidence cap, else point). `null` for every other recipe, routeable and legacy-binding rows included.
 */
export function mimirV1DirectDlmmWindow(d: Pick<V1Descriptor, "adapterType" | "adapterVersion" | "mode" | "externalWidth" | "temporalKind" | "bindingVersion">):
  "legacy" | "point" | "dual" | null {
  if (d.adapterType !== 3 || (d.adapterVersion !== 0 && d.adapterVersion !== 1) || d.bindingVersion === 0) return null;
  const e = d.externalWidth - d.adapterVersion;
  if (d.temporalKind === 0 && (d.mode === 1 && e === 4 || d.mode === 2 && e === 7)) return "legacy";
  if (d.temporalKind === 6 && d.mode === 2 && e === 7) return "dual";
  return d.temporalKind === 5 && d.mode === 5 && e === 6 ? "point" : null;
}

/** Vectors vs the decoded descriptors (base width plus 0..2 direct DLMM neighbours, no duplicate role), converter admission; sysvar iff any row (converter included) has byte 11 == 1. */
function refreshVectors(tag: 87 | 89, feed: MimirV1RefreshRows, primary: readonly (readonly Address[])[], converter: readonly (readonly Address[])[]) {
  const ps = feed.rows.map((x) => x.descriptor); const cs = (feed.converter?.rows ?? []).map((x) => x.descriptor);
  if (primary.length !== ps.length || converter.length !== cs.length) betaError("INVALID_ARGUMENT", `V1 tag${tag} vector count`);
  assertMimirClassicConverterAdmitted(cs as Parameters<typeof assertMimirClassicConverterAdmitted>[0]);
  const descriptors = [...ps, ...cs]; const vectors = [...primary, ...converter];
  vectors.forEach((v, i) => {
    const d = descriptors[i]!;
    if (v.length < d.externalWidth || v.length > d.externalWidth + (mimirV1DirectDlmmWindow(d) ? 2 : 0)) betaError("INVALID_ARGUMENT", `V1 tag${tag} external vector width`);
    const roles = v.filter((x, j) => !(x === MIMIR_BETA_SYSTEM_PROGRAM_ID && d.adapterType === 4 && j === 3));
    if (new Set(roles).size !== roles.length) betaError("INVALID_ARGUMENT", `V1 tag${tag} duplicate role inside one external vector`);
  });
  return { descriptors, externals: vectors.flat(), sysvar: descriptors.some((d) => d.requiresIxSysvar === 1) ? [r(MIMIR_INSTRUCTIONS_SYSVAR_ID)] : [] };
}

/** tag89: feed(w) = meta 0, registry, per-source vectors (primary then converter), instructions sysvar when a descriptor needs it. */
export function buildMimirV1FusedClassicRefreshInstruction(a: Readonly<{
  programId: Address; feed: Address; registry: Address; decoded: MimirV1RefreshRows; sourceAccounts: readonly (readonly Address[])[]; request: MimirFusedClassicRequest;
}>): MimirBetaInstruction {
  const n = a.request.componentCount;
  if (a.sourceAccounts.length !== n + a.request.converterSourceCount) betaError("INVALID_ARGUMENT", "V1 tag89 vector count");
  const { externals, sysvar } = refreshVectors(89, a.decoded, a.sourceAccounts.slice(0, n), a.sourceAccounts.slice(n));
  if (externals.includes(a.feed)) betaError("INVALID_ARGUMENT", "V1 tag89 writable alias");
  return ix(a.programId, [w(a.feed), r(a.registry), ...externals.map((x) => r(x)), ...sysvar], encodeMimirFusedClassicData(a.request));
}

/** tag87: payer(s,w), composite(w) = meta 1, registry, admin_config, treasury(w), System, N×w (+s), instructions sysvar when needed. */
export function buildMimirV1FusedCompositeRefreshInstruction(a: Readonly<{
  programId: Address; payer: Address; composite: Address; registry: Address; adminConfig: Address; treasury: Address; decoded: MimirV1RefreshRows;
  componentAccounts: readonly (readonly Address[])[]; converterAccounts: readonly (readonly Address[])[]; request: MimirFusedRefreshRequest;
}>): MimirBetaInstruction {
  if (a.componentAccounts.length !== a.request.componentSourceConfigRevisions.length ||
      a.converterAccounts.length !== a.request.converterRingNewestSlots.length) betaError("INVALID_ARGUMENT", "V1 tag87 vector count");
  const { descriptors, externals, sysvar } = refreshVectors(87, a.decoded, a.componentAccounts, a.converterAccounts);
  if (a.request.nextSnapshotRevision === a.request.previousSnapshotRevision && !descriptors.some((d) => d.mode === 4)) {
    betaError("INVALID_ARGUMENT", "V1 sample-only tag87 requires a mode-4 row");
  }
  if (new Set([a.payer, a.composite, a.treasury]).size !== 3 || externals.some((x) => x === a.composite || x === a.treasury)) {
    betaError("INVALID_ARGUMENT", "V1 tag87 writable alias");
  }
  return ix(a.programId, [w(a.payer, true), w(a.composite), r(a.registry), r(a.adminConfig), w(a.treasury), r(MIMIR_BETA_SYSTEM_PROGRAM_ID),
    ...externals.map((x) => r(x)), ...sysvar], encodeMimirFusedRefreshData(a.request));
}
