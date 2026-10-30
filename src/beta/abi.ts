import type { Address } from "@solana/kit";
import { getProgramDerivedAddressCached } from "./pdaMemo.js";
import { sha256 as sha256Sync } from "@noble/hashes/sha256";
import {
  addressBytes,
  bytesAddress,
  bytesEqual,
  concatBytes,
  isZeroBytes,
  sha256,
  utf8,
} from "./bytes.js";
import { betaError } from "./errors.js";
import { sourceAdapterSupportsVersion, type MimirBetaAdapterType, type MimirBetaAdapterVersion, type MimirBetaInstruction, type MimirBetaInstructionAccount } from "./types.js";
import type { MimirBetaEligiblePool } from "./discovery.js";
import { deriveMimirBetaPumpSwapBoostVault, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_TOKEN_2022_PROGRAM_ID } from "./capture.js";
import { freshNumberRecord } from "../internal/canonicalAuthority.js";
import { computeMimirCurrentPointSourceLeaf, mimirCurrentPointAdmitted, packMimirCompactDirection, type MimirTemporalMode } from "../internal/currentPointCore.js";

const SourceDirection = freshNumberRecord("SourceDirection");

export const MIMIR_BETA_TAG_PROPOSE_FEED_PLAN = 78;
export const MIMIR_BETA_TAG_ACTIVATE_IDENTITY_FEED_PLAN = 80;
export const MIMIR_BETA_TAG_CREATE_IDENTITY_COMPOSITE = 81;
export const MIMIR_BETA_IDENTITY_PROPOSAL_DATA_LENGTH = 270;
export const MIMIR_BETA_SOURCE_APPEND_DATA_LENGTH = 489;
export const MIMIR_BETA_IDENTITY_ACTIVATION_DATA_LENGTH = 13;
export const MIMIR_BETA_IDENTITY_COMPOSITE_DATA_LENGTH = 662;
export const MIMIR_BETA_CLASSIC_V0_LENGTH = 325;
export const MIMIR_BETA_CLASSIC_V1_LENGTH = 357;
export const MIMIR_BETA_COMPOSITE_V0_LENGTH = 629;
export const MIMIR_BETA_COMPOSITE_V1_LENGTH = 661;
export const MIMIR_BETA_PROPOSAL_HEADER_LENGTH = 608;
export const MIMIR_BETA_PROPOSAL_SOURCE_LENGTH = 392;
export const MIMIR_BETA_PRIMARY_TICKER_PRESENT = 1;

const U16_MAX = 0xffff;
const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const ZERO_32 = new Uint8Array(32);

/** Encodes lengths 1–11 as len:u8 + padded ASCII, and length 12 as twelve ASCII bytes. */
export function encodeMimirBetaTicker(ticker: string): Uint8Array {
  const bytes = utf8(canonicalizeMimirBetaTicker(ticker));
  const out = new Uint8Array(12);
  if (bytes.length === 12) out.set(bytes);
  else { out[0] = bytes.length; out.set(bytes, 1); }
  return out;
}

/** Validates ASCII before applying the canonical uppercase representation. */
export function canonicalizeMimirBetaTicker(ticker: string): string {
  if (typeof ticker !== "string" || !/^[A-Za-z0-9]{1,12}$/.test(ticker)) {
    betaError("INVALID_ARGUMENT", "ticker must match ASCII [A-Za-z0-9]{1,12}");
  }
  return ticker.toUpperCase();
}

/** Returns the checked activation tariff for a canonicalizable ticker. */
export function computeMimirBetaTickerTariff(baseAmountRaw: bigint, ticker: string): bigint {
  const length = canonicalizeMimirBetaTicker(ticker).length;
  if (length === 1) return 0n;
  if (typeof baseAmountRaw !== "bigint" || baseAmountRaw < 0n || baseAmountRaw > U64_MAX) {
    betaError("INVALID_ARGUMENT", "ticker tariff base must fit u64");
  }
  if (length === 2 || length === 3) {
    const multiplier = length === 2 ? 15n : 3n;
    if (baseAmountRaw > U64_MAX / multiplier) betaError("INVALID_ARGUMENT", "ticker tariff overflows u64");
    return baseAmountRaw * multiplier;
  }
  const divisor = length === 4 ? 2n : 5n;
  if (baseAmountRaw % divisor !== 0n) betaError("INVALID_ARGUMENT", "ticker tariff base is not exactly divisible");
  return baseAmountRaw / divisor;
}

/** Decodes and rejects every non-canonical ticker byte representation. */
export function decodeMimirBetaTicker(data: Uint8Array): string {
  if (!(data instanceof Uint8Array) || data.length !== 12) {
    betaError("ACCOUNT_MALFORMED", "ticker bytes are not canonical");
  }
  const length = data[0]!;
  const text = length >= 1 && length <= 11 ? data.subarray(1, 1 + length) : data;
  if ((length >= 1 && length <= 11 && data.subarray(1 + length).some((byte) => byte !== 0)) ||
    text.some((byte) => !(byte >= 48 && byte <= 57) && !(byte >= 65 && byte <= 90))) {
    betaError("ACCOUNT_MALFORMED", "ticker bytes are not canonical");
  }
  return String.fromCharCode(...text);
}

/** Converts a canonical positive integer quantity to exact Q64 without rounding. */
export function parseMimirBetaIntegerQuantityX64(value: string): bigint {
  if (typeof value !== "string" || !/^[1-9][0-9]*$/.test(value)) {
    betaError("INVALID_ARGUMENT", "quantity must be canonical positive integer decimal digits");
  }
  const integerValue = BigInt(value);
  if (integerValue > U64_MAX) betaError("INVALID_ARGUMENT", "integer quantity exceeds u64");
  return integerValue << 64n;
}

function integer(value: number, max: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) betaError("INVALID_ARGUMENT", `${label} out of range`);
}

function bigint(value: bigint, max: bigint, label: string, nonzero = false): void {
  if (typeof value !== "bigint" || value < 0n || value > max || (nonzero && value === 0n)) {
    betaError("INVALID_ARGUMENT", `${label} out of range`);
  }
}

function bytes32(value: Uint8Array, label: string, nonzero = false): Uint8Array {
  if (!(value instanceof Uint8Array) || value.length !== 32 || (nonzero && isZeroBytes(value))) {
    betaError("INVALID_ARGUMENT", `${label} must be ${nonzero ? "nonzero " : ""}32 bytes`);
  }
  return value;
}

function putU16(out: Uint8Array, offset: number, value: number): number {
  new DataView(out.buffer, out.byteOffset, out.byteLength).setUint16(offset, value, true);
  return offset + 2;
}

function putI32(out: Uint8Array, offset: number, value: number): number {
  new DataView(out.buffer, out.byteOffset, out.byteLength).setInt32(offset, value, true);
  return offset + 4;
}

function putU64(out: Uint8Array, offset: number, value: bigint): number {
  new DataView(out.buffer, out.byteOffset, out.byteLength).setBigUint64(offset, value, true);
  return offset + 8;
}

function putU128(out: Uint8Array, offset: number, value: bigint): number {
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setBigUint64(offset, value & U64_MAX, true);
  view.setBigUint64(offset + 8, value >> 64n, true);
  return offset + 16;
}

function put(out: Uint8Array, offset: number, value: Uint8Array): number {
  out.set(value, offset);
  return offset + value.length;
}

/** Program-compatible SHA-256 over raw concatenated byte slices. */
export async function mimirBetaHashv(parts: readonly Uint8Array[]): Promise<Uint8Array> {
  return sha256(concatBytes(...parts));
}

function classicFeedIdBytes(base: Uint8Array, quote: Uint8Array, variant: number): Uint8Array {
  return sha256Sync(concatBytes(utf8("MIMIR_MINT_PAIR_FEED_ID_V1"),
    variant === 0 ? Uint8Array.of(0) : Uint8Array.of(1, variant & 0xff, variant >> 8), base, quote));
}

export async function deriveMimirBetaClassicFeedId(baseMint: Address, quoteMint: Address, variant = 0): Promise<Address> {
  if (baseMint === quoteMint) betaError("INVALID_ARGUMENT", "classic mint pair aliases");
  integer(variant, 0xffff, "feed variant");
  return bytesAddress(classicFeedIdBytes(addressBytes(baseMint), addressBytes(quoteMint), variant));
}

const variantMemo = new Map<string, number | null>();
const variantInFlight = new Map<string, Promise<number | null>>();
let variantQueue: Promise<unknown> = Promise.resolve();

export function recoverMimirBetaFeedVariant(baseMint: Address, quoteMint: Address, feedId: Address): number | null {
  const key = `${baseMint}:${quoteMint}:${feedId}`;
  const memo = variantMemo.get(key);
  if (memo !== undefined) return memo;
  const base = addressBytes(baseMint), quote = addressBytes(quoteMint), id = addressBytes(feedId);
  let found: number | null = null;
  for (let variant = 0; variant <= 0xffff; variant++) if (bytesEqual(classicFeedIdBytes(base, quote, variant), id)) { found = variant; break; }
  variantMemo.set(key, found);
  return found;
}

/** Memoized `recoverMimirBetaFeedVariant` that yields to the event loop about every 8 ms or 2,048 candidates. */
export function recoverMimirBetaFeedVariantAsync(baseMint: Address, quoteMint: Address, feedId: Address): Promise<number | null> {
  const key = `${baseMint}:${quoteMint}:${feedId}`;
  const memo = variantMemo.get(key);
  if (memo !== undefined) return Promise.resolve(memo);
  const pending = variantInFlight.get(key);
  if (pending) return pending;
  const search = variantQueue.then(async () => {
    const memoNow = variantMemo.get(key);
    if (memoNow !== undefined) return memoNow;
    const base = addressBytes(baseMint), quote = addressBytes(quoteMint), id = addressBytes(feedId);
    let found: number | null = null;
    let sliceStart = Date.now();
    for (let variant = 0; variant <= 0xffff; variant++) {
      if (bytesEqual(classicFeedIdBytes(base, quote, variant), id)) { found = variant; break; }
      if ((variant & 0x7ff) === 0x7ff || Date.now() - sliceStart >= 8) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        sliceStart = Date.now();
      }
    }
    variantMemo.set(key, found);
    return found;
  }).finally(() => variantInFlight.delete(key));
  variantQueue = search.catch(() => undefined);
  variantInFlight.set(key, search);
  return search;
}

export async function deriveMimirBetaPda(args: {
  readonly programId: Address;
  readonly seed: string;
  readonly values?: readonly Uint8Array[];
}): Promise<readonly [Address, number]> {
  return getProgramDerivedAddressCached(args.programId, [utf8(args.seed), ...(args.values ?? [])]);
}

export async function deriveMimirBetaTickerPda(programId: Address, ticker: string): Promise<readonly [Address, number]> {
  return deriveMimirBetaPda({ programId, seed: "ticker", values: [utf8(canonicalizeMimirBetaTicker(ticker))] });
}

export async function deriveMimirBetaCanonicalPdas(programId: Address): Promise<Readonly<{
  registry: readonly [Address, number];
  admin: readonly [Address, number];
}>> {
  const v0 = Uint8Array.of(0, 0);
  const v1 = Uint8Array.of(1, 0);
  const [registry, admin] = await Promise.all([
    deriveMimirBetaPda({ programId, seed: "mimir_registry", values: [v0] }),
    deriveMimirBetaPda({ programId, seed: "admin_config", values: [v1] }),
  ]);
  return { registry, admin };
}

export async function deriveMimirBetaFeedPdas(args: {
  readonly programId: Address;
  readonly feedId: Address;
  readonly planId?: number;
  readonly planVersion?: number;
  readonly twapVersion?: number;
}): Promise<Readonly<Record<"feed" | "snapshot" | "collateralLock" | "sourcingPlan" | "twap", readonly [Address, number]>>> {
  const id = addressBytes(args.feedId);
  const planId = args.planId ?? 0;
  const planVersion = args.planVersion ?? 0;
  const twapVersion = args.twapVersion ?? 0;
  integer(planId, U16_MAX, "plan id"); integer(planVersion, U16_MAX, "plan version"); integer(twapVersion, U16_MAX, "TWAP version");
  const u16 = (value: number) => Uint8Array.of(value & 0xff, value >> 8);
  const [feed, snapshot, collateralLock, sourcingPlan, twap] = await Promise.all([
    deriveMimirBetaPda({ programId: args.programId, seed: "feed_config", values: [id] }),
    deriveMimirBetaPda({ programId: args.programId, seed: "feed_snapshot", values: [id] }),
    deriveMimirBetaPda({ programId: args.programId, seed: "feed_collateral_lock", values: [id] }),
    deriveMimirBetaPda({ programId: args.programId, seed: "sourcing_plan", values: [id, u16(planId), u16(planVersion)] }),
    deriveMimirBetaPda({ programId: args.programId, seed: "feed_twap", values: [id, u16(twapVersion)] }),
  ]);
  return { feed, snapshot, collateralLock, sourcingPlan, twap };
}

export async function deriveMimirBetaProposalHash(args: {
  readonly programId: Address;
  readonly proposer: Address;
  readonly feedId: Address;
  readonly registryStateHash: Uint8Array;
  readonly adminStateHash: Uint8Array;
  readonly snapshot: Uint8Array;
  readonly legacyInitArgs: Uint8Array;
  readonly identityAsset: Address;
  readonly planHash: Uint8Array;
}): Promise<Uint8Array> {
  if (args.legacyInitArgs.length !== 236) betaError("PROGRAM_ABI_MISMATCH", "classic init args must be 236 bytes");
  if (!(args.snapshot instanceof Uint8Array) || args.snapshot.length !== 96) {
    betaError("PROGRAM_ABI_MISMATCH", "classic proposal snapshot must be 96 bytes");
  }
  return mimirBetaHashv([
    utf8("MIMIR_FEED_PLAN_PROPOSAL_IDENTITY_V1"), addressBytes(args.programId), addressBytes(args.proposer),
    addressBytes(args.feedId), bytes32(args.registryStateHash, "registry state hash"),
    bytes32(args.adminStateHash, "admin state hash"),
    args.snapshot,
    args.legacyInitArgs,
    addressBytes(args.identityAsset), bytes32(args.planHash, "plan hash"),
  ]);
}

export function encodeMimirBetaProposalSnapshot(args: {
  readonly registryEpochAtProposal: bigint;
  readonly adminRevisionAtProposal: bigint;
  readonly refreshFeeDefaultLamportsAtProposal: bigint;
  readonly collateralAmountRawAtProposal: bigint;
  readonly collateralMintAtProposal: Address;
  readonly feeTreasuryAtProposal: Address;
}): Uint8Array {
  const out = new Uint8Array(96);
  bigint(args.registryEpochAtProposal, U64_MAX, "registry epoch", true);
  bigint(args.adminRevisionAtProposal, U64_MAX, "admin revision", true);
  bigint(args.refreshFeeDefaultLamportsAtProposal, U64_MAX, "refresh fee", true);
  bigint(args.collateralAmountRawAtProposal, U64_MAX, "collateral amount", true);
  putU64(out, 0, args.registryEpochAtProposal);
  putU64(out, 8, args.adminRevisionAtProposal);
  putU64(out, 16, args.refreshFeeDefaultLamportsAtProposal);
  putU64(out, 24, args.collateralAmountRawAtProposal);
  put(out, 32, bytes32(addressBytes(args.collateralMintAtProposal), "collateral mint", true));
  put(out, 64, bytes32(addressBytes(args.feeTreasuryAtProposal), "fee treasury", true));
  return out;
}

export interface MimirBetaCanonicalCompositeComponent {
  readonly feedId: Address;
  readonly sourceConfig: Address;
  readonly quantityX64: bigint;
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    if (left[index] !== right[index]) return left[index]! - right[index]!;
  }
  return left.length - right.length;
}

export function canonicalizeMimirBetaCompositeComponents(
  input: readonly MimirBetaCanonicalCompositeComponent[],
): readonly MimirBetaCanonicalCompositeComponent[] {
  if (input.length < 1 || input.length > 5) betaError("POOL_COUNT_OUT_OF_RANGE", "composite components must total 1..5");
  const seenFeeds = new Set<Address>(); const seenSources = new Set<Address>();
  const components = input.map((component) => {
    bigint(component.quantityX64, U128_MAX, "composite quantity X64", true);
    if (seenFeeds.has(component.feedId) || seenSources.has(component.sourceConfig)) betaError("INVALID_ARGUMENT", "duplicate composite feed or source config");
    seenFeeds.add(component.feedId); seenSources.add(component.sourceConfig);
    return { ...component };
  });
  return components.sort((left, right) => compareBytes(addressBytes(left.feedId), addressBytes(right.feedId)) ||
    compareBytes(addressBytes(left.sourceConfig), addressBytes(right.sourceConfig)) ||
    (left.quantityX64 < right.quantityX64 ? -1 : left.quantityX64 > right.quantityX64 ? 1 : 0));
}

export async function computeMimirBetaCompositeComponentSetHash(args: {
  readonly quoteMint: Address;
  readonly solConversionSourceConfig?: Address;
  readonly components: readonly MimirBetaCanonicalCompositeComponent[];
}): Promise<Uint8Array> {
  const components = canonicalizeMimirBetaCompositeComponents(args.components);
  const parts: Uint8Array[] = [utf8("MIMIR_COMPOSITE_COMPONENTS_V1"), addressBytes(args.quoteMint),
    Uint8Array.of(components.length), args.solConversionSourceConfig ? addressBytes(args.solConversionSourceConfig) : ZERO_32];
  for (const component of components) {
    const quantity = new Uint8Array(16); putU128(quantity, 0, component.quantityX64);
    parts.push(addressBytes(component.feedId), addressBytes(component.sourceConfig), quantity);
  }
  return mimirBetaHashv(parts);
}

export async function deriveMimirBetaCompositeFeedId(args: {
  readonly creator: Address;
  readonly quoteMint: Address;
  readonly solConversionSourceConfig?: Address;
  readonly priceExponent: number;
  readonly components: readonly MimirBetaCanonicalCompositeComponent[];
}): Promise<Address> {
  if (!Number.isInteger(args.priceExponent) || args.priceExponent < -36 || args.priceExponent > 19) betaError("INVALID_ARGUMENT", "composite price exponent out of range");
  const components = canonicalizeMimirBetaCompositeComponents(args.components);
  const exponent = new Uint8Array(4); putI32(exponent, 0, args.priceExponent);
  const componentSetHash = await computeMimirBetaCompositeComponentSetHash({ ...args, components });
  return bytesAddress(await mimirBetaHashv([utf8("MIMIR_COMPOSITE_FEED_ID_V1"), addressBytes(args.creator),
    addressBytes(args.quoteMint), exponent, Uint8Array.of(components.length), componentSetHash]));
}

export async function encodeMimirBetaCompositeV1Config(args: {
  readonly programId: Address;
  readonly creator: Address;
  readonly quoteMint: Address;
  readonly solConversionSourceConfig?: Address;
  readonly priceExponent: number;
  readonly maxSnapshotAgeSlots: number;
  readonly maxComponentSnapshotAgeSlots: number;
  readonly maxComponentConfidenceBps: number;
  readonly maxComponentDispersionBps: number;
  readonly registryEpoch: bigint;
  readonly configRevision: bigint;
  readonly adminConfigRevisionAtCreation: bigint;
  readonly components: readonly MimirBetaCanonicalCompositeComponent[];
  readonly identityAsset: Address;
  readonly ticker: string;
}): Promise<Readonly<{ config: Uint8Array; feedId: Address; configAddress: Address; componentSetHash: Uint8Array }>> {
  for (const value of [args.maxSnapshotAgeSlots, args.maxComponentSnapshotAgeSlots, args.maxComponentConfidenceBps,
    args.maxComponentDispersionBps]) integer(value, U16_MAX, "composite u16 field");
  if (args.maxSnapshotAgeSlots === 0 || args.maxComponentSnapshotAgeSlots === 0 || args.maxComponentConfidenceBps > 10_000 || args.maxComponentDispersionBps > 10_000) {
    betaError("INVALID_ARGUMENT", "composite policy field invalid");
  }
  bigint(args.registryEpoch, U64_MAX, "registry epoch", true); bigint(args.configRevision, U64_MAX, "config revision", true);
  bigint(args.adminConfigRevisionAtCreation, U64_MAX, "admin revision", true);
  const components = canonicalizeMimirBetaCompositeComponents(args.components);
  const feedId = await deriveMimirBetaCompositeFeedId({ ...args, components });
  const componentSetHash = await computeMimirBetaCompositeComponentSetHash({ ...args, components });
  const [configAddress, bump] = await deriveMimirBetaPda({ programId: args.programId, seed: "composite_feed_config", values: [addressBytes(feedId)] });
  const out = new Uint8Array(661); const outView = new DataView(out.buffer);
  out.set(utf8("MIMIRCFC"), 0); outView.setUint16(8, 1, true); outView.setUint16(10, 661, true);
  outView.setUint32(12, MIMIR_BETA_PRIMARY_TICKER_PRESENT, true);
  out.set(addressBytes(feedId), 16); out.set(addressBytes(args.creator), 48); out.set(addressBytes(args.quoteMint), 80);
  outView.setInt32(112, args.priceExponent, true); out[116] = 1; out[117] = 4; out[118] = 0; out[119] = components.length;
  outView.setUint16(120, args.maxSnapshotAgeSlots, true); outView.setUint16(122, args.maxComponentSnapshotAgeSlots, true);
  outView.setUint16(124, args.maxComponentConfidenceBps, true); outView.setUint16(126, args.maxComponentDispersionBps, true);
  out.set(componentSetHash, 128); outView.setBigUint64(160, args.registryEpoch, true);
  outView.setBigUint64(168, args.configRevision, true); outView.setBigUint64(176, args.adminConfigRevisionAtCreation, true);
  out[184] = bump; out.set(encodeMimirBetaTicker(args.ticker), 185);
  if (args.solConversionSourceConfig) out.set(addressBytes(args.solConversionSourceConfig), 197);
  components.forEach((component, index) => {
    const offset = 229 + index * 80;
    out.set(addressBytes(component.feedId), offset); out.set(addressBytes(component.sourceConfig), offset + 32);
    putU128(out, offset + 64, component.quantityX64);
  });
  out.set(addressBytes(args.identityAsset), 629);
  return { config: out, feedId, configAddress, componentSetHash };
}

export interface MimirBetaClassicInitArgs {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly sourceSetRoot: Uint8Array;
  readonly staticAccountsRoot: Uint8Array;
  readonly anchorPolicyHash: Uint8Array;
  readonly nativeExceptionHash: Uint8Array;
  readonly adapterMask: bigint;
  readonly namespaceVersion: number;
  readonly planId: number;
  readonly planVersion: number;
  readonly hashSchemeVersion: number;
  readonly ringVersion: number;
  readonly profile: number;
  readonly riskTier: number;
  readonly sourceCount: number;
  readonly minSources: number;
  readonly minVenues: number;
  readonly minCorrelationGroups: number;
  readonly baseDecimals: number;
  readonly quoteDecimals: number;
  readonly bindingVariants: readonly number[];
  readonly priceExponent: number;
  readonly maxDispersionBps: number;
  readonly maxSourceActivityAgeSlots: number;
  readonly minCoverageRatioBps: number;
  readonly maxConfidenceBps: number;
  readonly maxSnapshotAgeSlots: number;
}

export function encodeMimirBetaClassicInitArgs(args: MimirBetaClassicInitArgs): Uint8Array {
  const out = new Uint8Array(236);
  if (args.baseMint === args.quoteMint) betaError("INVALID_ARGUMENT", "classic mint pair aliases");
  bigint(args.adapterMask, U64_MAX, "adapter mask", true);
  const byteFields = [args.hashSchemeVersion, args.profile, args.riskTier, args.sourceCount, args.minSources,
    args.minVenues, args.minCorrelationGroups, args.baseDecimals, args.quoteDecimals, ...args.bindingVariants];
  byteFields.forEach((value) => integer(value, 0xff, "classic byte field"));
  if (args.sourceCount < 1 || args.sourceCount > 5 || args.bindingVariants.length !== 5) betaError("POOL_COUNT_OUT_OF_RANGE", "classic source total must be 1..5");
  [args.namespaceVersion, args.planId, args.planVersion, args.ringVersion, args.maxDispersionBps,
    args.maxSourceActivityAgeSlots, args.minCoverageRatioBps, args.maxConfidenceBps, args.maxSnapshotAgeSlots]
    .forEach((value) => integer(value, U16_MAX, "classic u16 field"));
  if (!Number.isInteger(args.priceExponent) || args.priceExponent < -36 || args.priceExponent > 19) betaError("INVALID_ARGUMENT", "price exponent out of range");
  if (args.maxConfidenceBps < 1 || args.maxConfidenceBps > 9_999) betaError("INVALID_ARGUMENT", "confidence out of range");
  let offset = 0;
  offset = put(out, offset, addressBytes(args.baseMint)); offset = put(out, offset, addressBytes(args.quoteMint));
  offset = put(out, offset, bytes32(args.sourceSetRoot, "source set root"));
  offset = put(out, offset, bytes32(args.staticAccountsRoot, "static accounts root"));
  offset = put(out, offset, bytes32(args.anchorPolicyHash, "anchor policy hash", true));
  offset = put(out, offset, bytes32(args.nativeExceptionHash, "native exception hash", true));
  offset = putU64(out, offset, args.adapterMask);
  offset = putU16(out, offset, args.namespaceVersion); offset = putU16(out, offset, args.planId); offset = putU16(out, offset, args.planVersion);
  out[offset++] = args.hashSchemeVersion; offset = putU16(out, offset, args.ringVersion);
  for (const value of [args.profile, args.riskTier, args.sourceCount, args.minSources, args.minVenues,
    args.minCorrelationGroups, args.baseDecimals, args.quoteDecimals, ...args.bindingVariants]) out[offset++] = value;
  offset = putI32(out, offset, args.priceExponent);
  for (const value of [args.maxDispersionBps, args.maxSourceActivityAgeSlots, args.minCoverageRatioBps,
    args.maxConfidenceBps, args.maxSnapshotAgeSlots]) offset = putU16(out, offset, value);
  if (offset !== 236) betaError("PROGRAM_ABI_MISMATCH", "classic init encoder length mismatch");
  return out;
}

export function encodeMimirBetaIdentityProposalData(args: MimirBetaClassicInitArgs, identityAsset: Address, variant = 0): Uint8Array {
  const asset = addressBytes(identityAsset);
  if (isZeroBytes(asset)) betaError("INVALID_ARGUMENT", "identity asset is zero");
  integer(variant, 0xffff, "feed variant");
  if (variant !== 0) return concatBytes(Uint8Array.of(78, 3), encodeMimirBetaClassicInitArgs(args), asset, Uint8Array.of(variant & 0xff, variant >> 8));
  const out = concatBytes(Uint8Array.of(78, 2), encodeMimirBetaClassicInitArgs(args), asset);
  if (out.length !== MIMIR_BETA_IDENTITY_PROPOSAL_DATA_LENGTH) betaError("PROGRAM_ABI_MISMATCH", "tag 78 mode 2 length mismatch");
  return out;
}

export interface MimirBetaCompactSourceArgs {
  readonly feedId: Address;
  readonly sourceIndex: number;
  readonly adapterType: MimirBetaAdapterType;
  readonly direction: 0 | 1;
  readonly adapterVersion: MimirBetaAdapterVersion;
  readonly venueGroup: number;
  readonly operatorGroup: number;
  readonly liquidityOwnerGroup: number;
  readonly routeCorrelationGroup: number;
  readonly quoteAssetGroup: number;
  readonly bridgeOrWrapperGroup: number;
  readonly oracleSourceClass: number;
  readonly upgradeAuthorityGroup: number;
  readonly maxSourceWeightBps: number;
  readonly minLiquidityNative: bigint;
  readonly minDepthTo50BpsNative: bigint;
  readonly programId: Address;
  readonly poolOrMarket: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly tokenProgram: Address;
  readonly vaultAuthority: Address;
  readonly sourceConfigRevision: bigint;
  readonly sourceSetRevision: bigint;
  readonly temporalMode?: MimirTemporalMode;
}

export function encodeMimirBetaCompactSource(args: MimirBetaCompactSourceArgs): Uint8Array {
  integer(args.sourceIndex, 4, "source index");
  if (![0, 1, 2, 3, 4, 6, 7].includes(args.adapterType) || (args.direction !== 0 && args.direction !== 1) ||
      !sourceAdapterSupportsVersion(args.adapterType, args.adapterVersion) ||
      (args.temporalMode === "current-point" && !mimirCurrentPointAdmitted(args.adapterType, args.adapterVersion)) ||
      (args.temporalMode !== undefined && args.temporalMode !== "current-point" && args.temporalMode !== "sampled-interval")) {
    betaError("INVALID_ARGUMENT", "source adapter fields invalid");
  }
  const groups = [args.venueGroup, args.operatorGroup, args.liquidityOwnerGroup, args.routeCorrelationGroup,
    args.quoteAssetGroup, args.bridgeOrWrapperGroup, args.oracleSourceClass, args.upgradeAuthorityGroup, args.maxSourceWeightBps];
  groups.forEach((value) => integer(value, U16_MAX, "source group"));
  if (args.maxSourceWeightBps < 1 || args.maxSourceWeightBps > 10_000) betaError("INVALID_ARGUMENT", "source weight invalid");
  bigint(args.minLiquidityNative, U128_MAX, "minimum liquidity", true);
  bigint(args.minDepthTo50BpsNative, U128_MAX, "minimum depth", true);
  bigint(args.sourceConfigRevision, U64_MAX, "source config revision", true);
  bigint(args.sourceSetRevision, U64_MAX, "source set revision", true);
  const out = new Uint8Array(295);
  let offset = 0;
  offset = put(out, offset, addressBytes(args.feedId)); out[offset++] = args.sourceIndex; out[offset++] = args.adapterType;
  out[offset++] = packMimirCompactDirection(args.direction, args.temporalMode); offset = putU16(out, offset, args.adapterVersion);
  for (const value of groups) offset = putU16(out, offset, value);
  offset = putU128(out, offset, args.minLiquidityNative); offset = putU128(out, offset, args.minDepthTo50BpsNative);
  for (const value of [args.programId, args.poolOrMarket, args.baseVault, args.quoteVault, args.tokenProgram, args.vaultAuthority]) {
    offset = put(out, offset, addressBytes(value));
  }
  offset = putU64(out, offset, args.sourceConfigRevision); offset = putU64(out, offset, args.sourceSetRevision);
  if (offset !== 295) betaError("PROGRAM_ABI_MISMATCH", "compact source encoder length mismatch");
  return out;
}

export function encodeMimirBetaSourceAppendData(args: {
  readonly source: MimirBetaCompactSourceArgs;
  readonly sourceRootProof: readonly Uint8Array[];
  readonly accountRootProof: readonly Uint8Array[];
}): Uint8Array {
  if (args.sourceRootProof.length !== 3 || args.accountRootProof.length !== 3) betaError("PROGRAM_ABI_MISMATCH", "source proofs must have depth three");
  const proofs = [...args.sourceRootProof, ...args.accountRootProof].map((value) => bytes32(value, "source proof"));
  const out = concatBytes(Uint8Array.of(78, 1), encodeMimirBetaCompactSource(args.source), ...proofs);
  if (out.length !== MIMIR_BETA_SOURCE_APPEND_DATA_LENGTH) betaError("PROGRAM_ABI_MISMATCH", "tag 78 mode 1 length mismatch");
  return out;
}

export function encodeMimirBetaIdentityActivationData(ticker: string): Uint8Array {
  return concatBytes(Uint8Array.of(80), encodeMimirBetaTicker(ticker));
}

/** Tag 81 with optional variant hints: one per component then the conversion; the tail is omitted when every hint is zero. */
export function encodeMimirBetaIdentityCompositeData(canonicalConfig: Uint8Array, hints: readonly number[] = []): Uint8Array {
  if (!(canonicalConfig instanceof Uint8Array) || canonicalConfig.length !== 661) {
    betaError("PROGRAM_ABI_MISMATCH", "canonical composite V1 config tuple invalid");
  }
  const view = new DataView(canonicalConfig.buffer, canonicalConfig.byteOffset, canonicalConfig.byteLength);
  const componentCount = canonicalConfig[119]!;
  const priceExponent = view.getInt32(112, true);
  if (view.getUint16(8, true) !== 1 || view.getUint16(10, true) !== 661 ||
    view.getUint32(12, true) !== MIMIR_BETA_PRIMARY_TICKER_PRESENT ||
    priceExponent < -36 || priceExponent > 19 ||
    isZeroBytes(canonicalConfig.subarray(629, 661)) || componentCount < 1 || componentCount > 5) {
    betaError("PROGRAM_ABI_MISMATCH", "canonical composite V1 config tuple invalid");
  }
  decodeMimirBetaTicker(canonicalConfig.subarray(185, 197));
  const feeds: Uint8Array[] = []; const sources: Uint8Array[] = [];
  let previous: Readonly<{ feed: Uint8Array; source: Uint8Array; quantity: bigint }> | undefined;
  for (let index = 0; index < componentCount; index += 1) {
    const offset = 229 + index * 80;
    const feed = canonicalConfig.subarray(offset, offset + 32);
    const source = canonicalConfig.subarray(offset + 32, offset + 64);
    const quantity = view.getBigUint64(offset + 64, true) | (view.getBigUint64(offset + 72, true) << 64n);
    const order = previous === undefined ? -1 : compareBytes(previous.feed, feed) || compareBytes(previous.source, source) ||
      (previous.quantity < quantity ? -1 : previous.quantity > quantity ? 1 : 0);
    if (isZeroBytes(feed) || isZeroBytes(source) || quantity === 0n ||
      feeds.some((value) => bytesEqual(value, feed)) || sources.some((value) => bytesEqual(value, source)) ||
      order >= 0) {
      betaError("PROGRAM_ABI_MISMATCH", "canonical composite V1 components invalid");
    }
    feeds.push(feed); sources.push(source); previous = { feed, source, quantity };
  }
  if (!isZeroBytes(canonicalConfig.subarray(229 + componentCount * 80, 629))) {
    betaError("PROGRAM_ABI_MISMATCH", "canonical composite V1 component tail invalid");
  }
  const out = concatBytes(Uint8Array.of(81), canonicalConfig);
  if (out.length !== MIMIR_BETA_IDENTITY_COMPOSITE_DATA_LENGTH) betaError("PROGRAM_ABI_MISMATCH", "tag 81 length mismatch");
  if (hints.every((hint) => hint === 0)) return out;
  if (hints.length !== componentCount + (isZeroBytes(canonicalConfig.subarray(197, 229)) ? 0 : 1)) {
    betaError("PROGRAM_ABI_MISMATCH", "tag 81 hint count mismatch");
  }
  const tail = new Uint8Array(1 + hints.length * 2); tail[0] = 1;
  hints.forEach((hint, index) => { integer(hint, 0xffff, "variant hint"); tail[1 + index * 2] = hint & 0xff; tail[2 + index * 2] = hint >> 8; });
  return concatBytes(out, tail);
}

export const MIMIR_BETA_PROPOSAL_OFFSETS = Object.freeze({ identityAsset: [464, 496] as const, variant: 496, reservedTail: [498, 512] as const });

export function readMimirBetaProposalVariant(data: Uint8Array): number {
  return data[MIMIR_BETA_PROPOSAL_OFFSETS.variant]! | (data[MIMIR_BETA_PROPOSAL_OFFSETS.variant + 1]! << 8);
}

export function assertMimirBetaStateTuple(args: {
  readonly kind: "classic" | "composite" | "proposal";
  readonly data: Uint8Array;
  readonly sourceCount?: number;
}): 0 | 1 {
  const data = args.data;
  if (!(data instanceof Uint8Array) || data.length < 12) betaError("PROGRAM_ABI_MISMATCH", "state tuple too short");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const version = view.getUint16(8, true);
  const header = view.getUint16(10, true);
  if (version !== 0 && version !== 1) betaError("PROGRAM_ABI_MISMATCH", "state version unsupported");
  const assertTickerExtension = (offset: number) => {
    const flags = view.getUint32(12, true);
    if (flags === 0) {
      if (!isZeroBytes(data.subarray(offset, offset + 12))) betaError("PROGRAM_ABI_MISMATCH", "ticker tail without flag");
    } else if (version === 1 && flags === MIMIR_BETA_PRIMARY_TICKER_PRESENT) {
      decodeMimirBetaTicker(data.subarray(offset, offset + 12));
    } else betaError("PROGRAM_ABI_MISMATCH", "ticker flags unsupported");
  };
  if (args.kind === "classic") {
    const length = version === 0 ? 325 : 357;
    if (data.length !== length || header !== length || (version === 1 && isZeroBytes(data.subarray(325, 357)))) betaError("PROGRAM_ABI_MISMATCH", "classic state tuple invalid");
    assertTickerExtension(313);
  } else if (args.kind === "composite") {
    const length = version === 0 ? 629 : 661;
    if (data.length !== length || header !== length || (version === 1 && isZeroBytes(data.subarray(629, 661)))) betaError("PROGRAM_ABI_MISMATCH", "composite state tuple invalid");
    assertTickerExtension(185);
  } else {
    const sourceCount = args.sourceCount ?? -1;
    integer(sourceCount, 5, "proposal source count");
    if (sourceCount === 0) betaError("PROGRAM_ABI_MISMATCH", "proposal source count out of range");
    const expected = 608 + sourceCount * 392;
    const [assetStart, assetEnd] = MIMIR_BETA_PROPOSAL_OFFSETS.identityAsset, [tailStart, tailEnd] = MIMIR_BETA_PROPOSAL_OFFSETS.reservedTail;
    if (data.length !== expected || header !== 608 || (version === 0 && !isZeroBytes(data.subarray(assetStart, assetEnd))) ||
      (version === 1 && isZeroBytes(data.subarray(assetStart, assetEnd))) || !isZeroBytes(data.subarray(tailStart, tailEnd)) ||
      (version === 0 && view.getUint16(MIMIR_BETA_PROPOSAL_OFFSETS.variant, true) !== 0) ||
      [512, 520, 528, 536].some((offset) => view.getBigUint64(offset, true) === 0n) ||
      isZeroBytes(data.subarray(544, 576)) || isZeroBytes(data.subarray(576, 608))) {
      betaError("PROGRAM_ABI_MISMATCH", "proposal state tuple invalid");
    }
  }
  return version;
}

function instruction(programAddress: Address, accounts: readonly MimirBetaInstructionAccount[], data: Uint8Array): MimirBetaInstruction {
  if (accounts.some((account) => account.address === programAddress)) betaError("INVALID_ARGUMENT", "program account aliases instruction meta");
  return { programAddress, accounts: [...accounts], data };
}

export function buildMimirBetaIdentityProposalInstruction(args: {
  readonly programId: Address;
  readonly accounts: readonly MimirBetaInstructionAccount[];
  readonly init: MimirBetaClassicInitArgs;
  readonly identityAsset: Address;
  readonly variant?: number;
}): MimirBetaInstruction {
  if (args.accounts.length !== 7) betaError("PROGRAM_ABI_MISMATCH", "tag 78 mode 2 requires the classic 7-account prefix");
  return instruction(args.programId, args.accounts, encodeMimirBetaIdentityProposalData(args.init, args.identityAsset, args.variant));
}

export function buildMimirBetaSourceAppendInstruction(args: {
  readonly programId: Address;
  readonly accounts: readonly MimirBetaInstructionAccount[];
  readonly source: MimirBetaCompactSourceArgs;
  readonly sourceRootProof: readonly Uint8Array[];
  readonly accountRootProof: readonly Uint8Array[];
}): MimirBetaInstruction {
  if (args.accounts.length < 2) betaError("PROGRAM_ABI_MISMATCH", "tag 78 mode 1 static accounts missing");
  return instruction(args.programId, args.accounts, encodeMimirBetaSourceAppendData(args));
}

export function buildMimirBetaIdentityActivationInstruction(args: {
  readonly programId: Address;
  readonly accounts: readonly MimirBetaInstructionAccount[];
  readonly sourceBundleAccountCount: number;
  readonly ticker: string;
}): MimirBetaInstruction {
  integer(args.sourceBundleAccountCount, 50, "source bundle account count");
  if (args.sourceBundleAccountCount === 0) betaError("PROGRAM_ABI_MISMATCH", "tag 80 source bundle missing");
  if (args.accounts.length !== 17 + args.sourceBundleAccountCount) betaError("PROGRAM_ABI_MISMATCH", "tag 80 account count mismatch");
  const tickerIndex = 12 + args.sourceBundleAccountCount; const ticker = args.accounts[tickerIndex]!;
  if (ticker.isSigner || !ticker.isWritable || args.accounts.some((account, index) => index !== tickerIndex && account.address === ticker.address)) {
    betaError("PROGRAM_ABI_MISMATCH", "tag 80 ticker account role or alias mismatch");
  }
  return instruction(args.programId, args.accounts, encodeMimirBetaIdentityActivationData(args.ticker));
}

export function buildMimirBetaIdentityCompositeInstruction(args: {
  readonly programId: Address;
  readonly accounts: readonly MimirBetaInstructionAccount[];
  readonly canonicalConfig: Uint8Array;
  readonly componentSourceCount: number;
  readonly variantHints?: readonly number[];
}): MimirBetaInstruction {
  integer(args.componentSourceCount, 6, "composite source count");
  const componentCount = args.canonicalConfig[119]!;
  if (componentCount < 1 || componentCount > 5) betaError("PROGRAM_ABI_MISMATCH", "tag 81 composite component count must be 1..5");
  const expectedSources = componentCount + (isZeroBytes(args.canonicalConfig.subarray(197, 229)) ? 0 : 1);
  if (args.componentSourceCount === 0 || args.componentSourceCount !== expectedSources) {
    betaError("PROGRAM_ABI_MISMATCH", "tag 81 source count mismatch");
  }
  if (args.accounts.length !== 17 + args.componentSourceCount + 3 * componentCount) {
    betaError("PROGRAM_ABI_MISMATCH", "tag 81 account count mismatch");
  }
  const tickerIndex = 11 + args.componentSourceCount; const ticker = args.accounts[tickerIndex]!;
  if (ticker.isSigner || !ticker.isWritable || args.accounts.some((account, index) => index !== tickerIndex && account.address === ticker.address)) {
    betaError("PROGRAM_ABI_MISMATCH", "tag 81 ticker account role or alias mismatch");
  }
  return instruction(args.programId, args.accounts, encodeMimirBetaIdentityCompositeData(args.canonicalConfig, args.variantHints));
}

export function sameMimirBetaBytes(left: Uint8Array, right: Uint8Array): boolean {
  return bytesEqual(left, right);
}

export interface MimirBetaPhysicalAccountFact {
  readonly address: Address;
  readonly owner: Address;
  readonly executable: boolean;
}

export interface MimirBetaClassicSourceArtifact {
  readonly source: MimirBetaCompactSourceArgs;
  readonly sourceConfig: Address;
  readonly sourceRing: Address;
  readonly nativeProof: Address | null;
  readonly sourceRootProof: readonly Uint8Array[];
  readonly accountRootProof: readonly Uint8Array[];
  readonly staticAccounts: readonly Address[];
  readonly boostVault: Address | null;
}

async function physicalAccountHash(position: number, account: MimirBetaPhysicalAccountFact): Promise<Uint8Array> {
  const material = new Uint8Array(66);
  material[0] = position; material.set(addressBytes(account.address), 1); material.set(addressBytes(account.owner), 33);
  material[65] = account.executable ? 1 : 0;
  return mimirBetaHashv([utf8("MIMIR_PHYSICAL_ACCOUNT_V1"), material]);
}

function dynamicRoleCommitment(adapterType: number, variant: number): Uint8Array {
  if (variant === 0 && [2, 4, 6, 7].includes(adapterType)) return Uint8Array.of(1, 0, 0, 0, 0, 0, 0, 0);
  if (adapterType === 0 && variant === 1) return Uint8Array.of(1, 1, 3, 1, 2, 3, 0, 0);
  if (adapterType === 1 && variant === 1) return Uint8Array.of(1, 2, 3, 1, 2, 3, 0, 0);
  if (adapterType === 3 && variant === 0) return Uint8Array.of(1, 3, 1, 2, 0, 0, 0, 0);
  if (adapterType === 3 && variant === 1) return Uint8Array.of(1, 4, 3, 1, 2, 3, 0, 0);
  return betaError("PROGRAM_ABI_MISMATCH", "unsupported adapter binding variant");
}

async function sourceSemanticLeaf(args: {
  readonly source: MimirBetaCompactSourceArgs;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly bump: number;
}): Promise<Uint8Array> {
  const source = args.source;
  const material = new Uint8Array(362); let offset = 0;
  material[offset++] = 1; offset = put(material, offset, addressBytes(source.feedId));
  for (const value of [source.sourceIndex, source.adapterType, 0, source.direction]) material[offset++] = value;
  for (const value of [source.adapterVersion, source.venueGroup, source.operatorGroup, source.liquidityOwnerGroup,
    source.routeCorrelationGroup, source.quoteAssetGroup, source.bridgeOrWrapperGroup, source.oracleSourceClass,
    source.upgradeAuthorityGroup, source.maxSourceWeightBps]) offset = putU16(material, offset, value);
  offset = putU128(material, offset, source.minLiquidityNative); offset = putU128(material, offset, source.minDepthTo50BpsNative);
  for (const value of [source.programId, source.poolOrMarket, source.baseVault, source.quoteVault, args.baseMint,
    args.quoteMint, source.tokenProgram, source.vaultAuthority]) offset = put(material, offset, addressBytes(value));
  offset = putU64(material, offset, source.sourceConfigRevision); offset = putU64(material, offset, source.sourceSetRevision);
  material[offset++] = args.bump;
  if (offset !== material.length) betaError("PROGRAM_ABI_MISMATCH", "source semantic leaf length mismatch");
  if (source.temporalMode === "current-point") return computeMimirCurrentPointSourceLeaf(material);
  return mimirBetaHashv([utf8("MIMIR_SOURCE_CONFIG_LEAF_V1"), material]);
}

async function emptyLeaf(treeKind: 1 | 2, feedId: Address, index: number): Promise<Uint8Array> {
  return mimirBetaHashv([utf8(treeKind === 1 ? "MIMIR_SOURCE_CONFIG_EMPTY_V1" : "MIMIR_ADAPTER_BINDING_EMPTY_V1"),
    Uint8Array.of(1), addressBytes(feedId), Uint8Array.of(index)]);
}

async function emptyStaticLeaf(feedId: Address, index: number): Promise<Uint8Array> {
  return mimirBetaHashv([utf8("MIMIR_ADAPTER_STATIC_BINDING_EMPTY_V1"), Uint8Array.of(1, 1), addressBytes(feedId), Uint8Array.of(index)]);
}

async function staticBindingLeaf(args: {
  readonly source: MimirBetaCompactSourceArgs;
  readonly variant: number;
  readonly semanticLeaf: Uint8Array;
  readonly accounts: readonly MimirBetaPhysicalAccountFact[];
}): Promise<Uint8Array> {
  const expected = args.source.adapterVersion === 1 && (args.source.adapterType === 1 || args.source.adapterType === 3)
    ? args.source.adapterType === 1 ? 5 : 4
    : ({ 0: 4, 1: 4, 2: 4, 3: 3, 4: 6, 6: 7, 7: 3 } as const)[args.source.adapterType];
  if (args.accounts.length !== expected) betaError("PROGRAM_ABI_MISMATCH", "static binding account count mismatch");
  const prefix = new Uint8Array(80); prefix[0] = 1; prefix[1] = 1; prefix.set(addressBytes(args.source.feedId), 2);
  prefix[34] = args.source.sourceIndex; prefix[35] = args.source.adapterType;
  putU16(prefix, 36, args.source.adapterVersion); prefix[38] = args.variant; prefix[39] = args.accounts.length;
  prefix.set(dynamicRoleCommitment(args.source.adapterType, args.variant), 40); prefix.set(args.semanticLeaf, 48);
  return mimirBetaHashv([utf8("MIMIR_ADAPTER_STATIC_BINDING_LEAF_V1"), prefix,
    ...(await Promise.all(args.accounts.map((account, index) => physicalAccountHash(index, account))))]);
}

async function merkleNode(treeKind: 1 | 2, level: number, parent: number, left: Uint8Array, right: Uint8Array): Promise<Uint8Array> {
  return mimirBetaHashv([utf8("MIMIR_MERKLE_NODE_V1"), Uint8Array.of(treeKind, level, parent), left, right]);
}

async function merkleRoot(treeKind: 1 | 2, leaves: readonly Uint8Array[]): Promise<Uint8Array> {
  let nodes: Uint8Array[] = leaves.map((leaf) => Uint8Array.from(leaf)); let level = 0;
  while (nodes.length > 1) {
    const parents: Uint8Array[] = [];
    for (let index = 0; index < nodes.length; index += 2) parents.push(await merkleNode(treeKind, level, index / 2, nodes[index]!, nodes[index + 1]!));
    nodes = parents; level += 1;
  }
  return nodes[0]!;
}

async function merkleProof(treeKind: 1 | 2, leaves: readonly Uint8Array[], leafIndex: number): Promise<readonly Uint8Array[]> {
  let nodes: Uint8Array[] = leaves.map((leaf) => Uint8Array.from(leaf)); let index = leafIndex; let level = 0; const proof: Uint8Array[] = [];
  while (nodes.length > 1) {
    proof.push(nodes[index ^ 1]!);
    const parents: Uint8Array[] = [];
    for (let cursor = 0; cursor < nodes.length; cursor += 2) parents.push(await merkleNode(treeKind, level, cursor / 2, nodes[cursor]!, nodes[cursor + 1]!));
    nodes = parents; index = Math.floor(index / 2); level += 1;
  }
  return proof;
}

export function lifecycleDomain(adapterType: MimirBetaAdapterType): 0 | 1 | 2 | 3 {
  if (adapterType === 0) return 0;
  if (adapterType === 1 || adapterType === 2 || adapterType === 4) return 1;
  if (adapterType === 3 || adapterType === 7) return 2;
  if (adapterType === 6) return 3;
  return betaError("PROGRAM_ABI_MISMATCH", "classic source adapter has no lifecycle domain");
}

export async function buildMimirBetaClassicSourceArtifacts(args: {
  readonly programId: Address;
  readonly feedId: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly pools: readonly MimirBetaEligiblePool[];
  readonly physicalAccounts: readonly MimirBetaPhysicalAccountFact[];
  /** @internal Exact decoded on-chain headers when reconstructing an existing source set. */
  readonly authoritativeSources?: readonly MimirBetaCompactSourceArgs[];
  readonly twapVersion?: number;
  /** Applies to AMMv4/PumpSwap sources, and to DLMM rows flagged in `dlmmPointRows`; other families keep sampled-interval. */
  readonly temporalMode?: MimirTemporalMode;
  readonly dlmmPointRows?: readonly boolean[];
}): Promise<Readonly<{
  sourceSetRoot: Uint8Array;
  staticAccountsRoot: Uint8Array;
  artifacts: readonly MimirBetaClassicSourceArtifact[];
  adapterMask: bigint;
  lifecycleGroupCount: number;
}>> {
  if (args.pools.length < 1 || args.pools.length > 5) betaError("POOL_COUNT_OUT_OF_RANGE", "classic pools must total 1..5");
  const facts = new Map(args.physicalAccounts.map((account) => [account.address, account]));
  const pumpV1Mixed = args.pools.some((pool) => pool.creation.adapterType === 6 && pool.creation.adapterVersion === 1) &&
    args.pools.some((pool) => pool.creation.adapterType !== 6);
  const pumpV1 = args.pools.some((pool) => pool.creation.adapterType === 6 && pool.creation.adapterVersion === 1);
  const dlmmV1 = args.pools.some((pool) => pool.creation.adapterType === 3 && pool.creation.adapterVersion === 1);
  const validPumpV1Set = pumpV1Mixed
    ? dlmmV1 && !args.pools.some((pool) =>
      (pool.creation.adapterType !== 3 && pool.creation.adapterType !== 6) || pool.creation.adapterVersion !== 1 ||
      pool.creation.tokenProgramId !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID || pool.creation.token2022Mint !== args.baseMint ||
      (pool.creation.adapterType === 3 && (pool.creation.staticAccounts.at(-1)?.role !== "token2022-mint" ||
        pool.creation.staticAccounts.at(-1)?.address !== args.baseMint)) ||
      (pool.creation.adapterType === 6 && (pool.creation.staticAccounts[0]?.role !== "base-mint" ||
        pool.creation.staticAccounts[0]?.address !== args.baseMint)))
    : !args.pools.some((pool) => pool.creation.adapterType !== 6 || pool.creation.adapterVersion !== 1 ||
      pool.creation.tokenProgramId !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID || pool.creation.token2022Mint !== args.baseMint);
  if (pumpV1 && (!validPumpV1Set || facts.get(args.baseMint)?.owner !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID ||
      facts.get(args.quoteMint)?.owner !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID)) {
    betaError("PROGRAM_ABI_MISMATCH", "PumpSwap Token-2022 requires bound V1 sources; mixed feeds permit only independently bound DLMM V1 with classic quote");
  }
  if (dlmmV1 && !pumpV1Mixed && (args.pools.some((pool) =>
      pool.creation.adapterType !== 3 || pool.creation.adapterVersion !== 1 ||
      pool.creation.tokenProgramId !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID ||
      pool.creation.token2022Mint !== args.pools[0]!.creation.token2022Mint ||
      pool.creation.staticAccounts.at(-1)?.role !== "token2022-mint" ||
      pool.creation.staticAccounts.at(-1)?.address !== pool.creation.token2022Mint) ||
      args.pools[0]!.creation.token2022Mint === null ||
      ![args.baseMint, args.quoteMint].includes(args.pools[0]!.creation.token2022Mint) ||
      facts.get(args.pools[0]!.creation.token2022Mint)?.owner !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID ||
      facts.get(args.pools[0]!.creation.token2022Mint === args.baseMint ? args.quoteMint : args.baseMint)?.owner !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID)) {
    betaError("PROGRAM_ABI_MISMATCH", "DLMM V1 Token-2022 requires an independently bound DLMM V1 source set");
  }
  const semanticLeaves = await Promise.all(Array.from({ length: 8 }, (_, index) => emptyLeaf(1, args.feedId, index)));
  const staticLeaves = await Promise.all(Array.from({ length: 8 }, (_, index) => emptyStaticLeaf(args.feedId, index)));
  const preliminary: Omit<MimirBetaClassicSourceArtifact, "sourceRootProof" | "accountRootProof">[] = [];
  const groupByDomain = new Map<number, number>();
  let adapterMask = 0n;
  for (let index = 0; index < args.pools.length; index += 1) {
    const pool = args.pools[index]!; const domain = lifecycleDomain(pool.creation.adapterType);
    let venueGroup = groupByDomain.get(domain);
    if (venueGroup === undefined) { venueGroup = groupByDomain.size; groupByDomain.set(domain, venueGroup); }
    const variant = pool.creation.bindingVariant === "routeable" ? 1 : 0;
    const [sourceConfig, bump] = await deriveMimirBetaPda({ programId: args.programId, seed: "source_config", values: [addressBytes(args.feedId), Uint8Array.of(index)] });
    const [sourceRing] = await deriveMimirBetaPda({ programId: args.programId, seed: "source_ring", values: [addressBytes(args.feedId), Uint8Array.of(index), Uint8Array.of(1, 0)] });
    const source: MimirBetaCompactSourceArgs = args.authoritativeSources?.[index] ?? {
      feedId: args.feedId, sourceIndex: index, adapterType: pool.creation.adapterType, direction: SourceDirection.QuotePerBase, adapterVersion: pool.creation.adapterVersion,
      venueGroup, operatorGroup: pool.creation.operatorGroup, liquidityOwnerGroup: pool.creation.liquidityOwnerGroup,
      routeCorrelationGroup: venueGroup, quoteAssetGroup: pool.creation.quoteAssetGroup,
      bridgeOrWrapperGroup: pool.creation.bridgeOrWrapperGroup, oracleSourceClass: pool.creation.oracleSourceClass,
      upgradeAuthorityGroup: pool.creation.upgradeAuthorityGroup, maxSourceWeightBps: Math.ceil(10_000 / args.pools.length),
      minLiquidityNative: pool.minLiquidityNative, minDepthTo50BpsNative: pool.minDepthTo50BpsNative,
      programId: pool.programId, poolOrMarket: pool.pool, baseVault: pool.baseVault, quoteVault: pool.quoteVault,
      tokenProgram: pool.creation.tokenProgramId, vaultAuthority: pool.creation.vaultAuthority,
      sourceConfigRevision: 1n, sourceSetRevision: 1n,
      ...(args.temporalMode === "current-point" && (pool.creation.adapterType !== 3 || args.dlmmPointRows?.[index] === true) && mimirCurrentPointAdmitted(pool.creation.adapterType, pool.creation.adapterVersion)
        ? { temporalMode: "current-point" as const } : {}),
    };
    const semanticLeaf = await sourceSemanticLeaf({ source, baseMint: args.baseMint, quoteMint: args.quoteMint, bump });
    const staticFacts = pool.creation.staticAccounts.map((account) => facts.get(account.address) ?? betaError("CREATION_CONTEXT_REQUIRED", "static account fact missing", account.address));
    semanticLeaves[index] = semanticLeaf;
    staticLeaves[index] = await staticBindingLeaf({ source, variant, semanticLeaf, accounts: staticFacts });
    let nativeProof: Address | null = null;
    if (pool.creation.adapterType === 2) {
      if (!pool.creation.observationState) betaError("PROGRAM_ABI_MISMATCH", "CPMM observation missing");
      [nativeProof] = await deriveMimirBetaPda({ programId: args.programId, seed: "native_twap_proof", values: [addressBytes(args.feedId), Uint8Array.of(args.twapVersion ?? 0, 0), Uint8Array.of(index), addressBytes(pool.creation.observationState)] });
    }
    preliminary.push({ source, sourceConfig, sourceRing, nativeProof, staticAccounts: pool.creation.staticAccounts.map((account) => account.address),
      boostVault: pool.creation.adapterType === 6
        ? deriveMimirBetaPumpSwapBoostVault(pool.creation.staticAccounts[4]!.address,
          pool.creation.staticAccounts[pool.pumpSwapBaseIsA === false ? 0 : 1]!.address, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID) : null });
    adapterMask |= 1n << BigInt(pool.creation.adapterType);
  }
  const [sourceSetRoot, staticAccountsRoot] = await Promise.all([merkleRoot(1, semanticLeaves), merkleRoot(2, staticLeaves)]);
  const artifacts = await Promise.all(preliminary.map(async (artifact, index) => ({ ...artifact,
    sourceRootProof: await merkleProof(1, semanticLeaves, index), accountRootProof: await merkleProof(2, staticLeaves, index) })));
  return { sourceSetRoot, staticAccountsRoot, artifacts, adapterMask, lifecycleGroupCount: groupByDomain.size };
}

export async function computeMimirBetaClassicPlanHash(args: {
  readonly feedId: Address;
  readonly profile: number;
  readonly riskTier: number;
  readonly minSources: number;
  readonly minVenues: number;
  readonly minCorrelationGroups: number;
  readonly maxDispersionBps: number;
  readonly maxSourceActivityAgeSlots: number;
  readonly priceExponent: number;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly sourceSetRoot: Uint8Array;
  readonly staticAccountsRoot: Uint8Array;
  readonly twap: Address;
  readonly anchorPolicyHash: Uint8Array;
  readonly adapterMask: bigint;
}): Promise<Uint8Array> {
  const u16 = (value: number) => { const out = new Uint8Array(2); putU16(out, 0, value); return out; };
  const i32 = new Uint8Array(4); putI32(i32, 0, args.priceExponent); const mask = new Uint8Array(8); putU64(mask, 0, args.adapterMask);
  return mimirBetaHashv([utf8("MIMIR_MINT_ORACLE_PLAN_V3"), Uint8Array.of(1), Uint8Array.of(1, 0), Uint8Array.of(1),
    addressBytes(args.feedId), Uint8Array.of(0, 0), Uint8Array.of(0, 0), Uint8Array.of(args.profile, args.riskTier,
      args.minSources, args.minVenues, args.minCorrelationGroups), u16(args.maxDispersionBps), u16(args.maxSourceActivityAgeSlots),
    i32, addressBytes(args.baseMint), addressBytes(args.quoteMint), args.sourceSetRoot, args.staticAccountsRoot,
    addressBytes(args.twap), args.anchorPolicyHash, mask]);
}
