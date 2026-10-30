import type { Address } from "@solana/kit";
import {
  addressBytes,
  assertZeroBytes,
  bytesAddress,
  bytesEqual,
  hex,
  isZeroBytes,
  utf8,
} from "./bytes.js";
import { betaError } from "./errors.js";
import { decodeMimirBetaTicker, encodeMimirBetaTicker, MIMIR_BETA_PRIMARY_TICKER_PRESENT } from "./abi.js";

const CLASSIC_MAGIC = utf8("MIMIRCFG");
const COMPOSITE_MAGIC = utf8("MIMIRCFC");
const CLASSIC_V0_LENGTH = 325;
const CLASSIC_V1_LENGTH = 357;
const COMPOSITE_V0_LENGTH = 629;
const COMPOSITE_V1_LENGTH = 661;

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

function key(data: Uint8Array, offset: number, label: string, allowZero = false): Address | null {
  const bytes = data.subarray(offset, offset + 32);
  if (bytes.length !== 32) betaError("ACCOUNT_MALFORMED", `${label} out of bounds`);
  if (isZeroBytes(bytes)) {
    if (allowZero) return null;
    betaError("ACCOUNT_MALFORMED", `${label} is zero`);
  }
  return bytesAddress(bytes);
}

function header(data: Uint8Array, magic: Uint8Array, v0: number, v1: number, allowV0: boolean): 0 | 1 {
  if (!bytesEqual(data.subarray(0, 8), magic)) betaError("ACCOUNT_MALFORMED", "wrong magic");
  const dataView = view(data);
  const version = dataView.getUint16(8, true);
  const headerLength = dataView.getUint16(10, true);
  if (allowV0 && version === 0 && data.length === v0 && headerLength === v0) return 0;
  if (version === 1 && data.length === v1 && headerLength === v1) return 1;
  betaError("ACCOUNT_MALFORMED", "wrong version/header/length tuple");
}

export interface MimirClassicConfig {
  readonly version: 0 | 1;
  readonly rawV0: Uint8Array;
  readonly feedId: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly bump: number;
  readonly identityAsset: Address | null;
  readonly ticker: string | null;
}

export function decodeMimirClassicConfig(data: Uint8Array, allowV0 = false): MimirClassicConfig {
  return decodeClassicConfig(data, allowV0);
}

function decodeClassicConfig(data: Uint8Array, allowV0: boolean): MimirClassicConfig {
  const version = header(data, CLASSIC_MAGIC, CLASSIC_V0_LENGTH, CLASSIC_V1_LENGTH, allowV0);
  const flags = view(data).getUint32(12, true);
  if (flags !== 0 && flags !== MIMIR_BETA_PRIMARY_TICKER_PRESENT || version === 0 && flags !== 0) {
    betaError("ACCOUNT_MALFORMED", "classic flags unsupported");
  }
  assertZeroBytes(data.subarray(123, 124), "classic reserved0");
  assertZeroBytes(data.subarray(134, 136), "classic reserved1");
  const ticker = flags === MIMIR_BETA_PRIMARY_TICKER_PRESENT
    ? decodeMimirBetaTicker(data.subarray(313, 325))
    : (assertZeroBytes(data.subarray(313, 325), "classic reserved tail"), null);
  const dataView = view(data);
  for (const offset of [124, 126, 128]) {
    if (dataView.getUint16(offset, true) > 10_000) betaError("ACCOUNT_MALFORMED", "classic bps out of range");
  }
  if (data[116]! > 3 || data[117]! > 7 || bytesEqual(data.subarray(48, 80), data.subarray(80, 112))) {
    betaError("ACCOUNT_MALFORMED", "classic enum or mint pair invalid");
  }
  const identityAsset = version === 1 ? key(data, 325, "identity asset") : null;
  const rawV0 = Uint8Array.from(data.subarray(0, 325));
  view(rawV0).setUint16(8, 0, true);
  view(rawV0).setUint16(10, 325, true);
  rawV0.fill(0, 12, 16);
  rawV0.fill(0, 313, 325);
  return {
    version,
    rawV0,
    feedId: key(data, 16, "feed id")!,
    baseMint: key(data, 48, "base mint")!,
    quoteMint: key(data, 80, "quote mint")!,
    bump: data[312]!,
    identityAsset,
    ticker,
  };
}

export interface MimirCompositeComponentCodec {
  readonly feed: Address;
  readonly sourceConfig: Address;
  readonly quantityX64: bigint;
}

export interface MimirCompositeConfig {
  readonly version: 0 | 1;
  readonly rawV0: Uint8Array;
  readonly feedId: Address;
  readonly creator: Address;
  readonly quoteMint: Address;
  readonly bump: number;
  readonly components: readonly MimirCompositeComponentCodec[];
  readonly identityAsset: Address | null;
  readonly ticker: string | null;
}

export function decodeMimirCompositeConfig(data: Uint8Array): MimirCompositeConfig {
  return decodeCompositeConfig(data, false);
}

function decodeCompositeConfig(data: Uint8Array, allowV0: boolean): MimirCompositeConfig {
  const version = header(data, COMPOSITE_MAGIC, COMPOSITE_V0_LENGTH, COMPOSITE_V1_LENGTH, allowV0);
  const flags = view(data).getUint32(12, true);
  if (flags !== 0 && flags !== MIMIR_BETA_PRIMARY_TICKER_PRESENT || version === 0 && flags !== 0) {
    betaError("ACCOUNT_MALFORMED", "composite flags unsupported");
  }
  const ticker = flags === MIMIR_BETA_PRIMARY_TICKER_PRESENT
    ? decodeMimirBetaTicker(data.subarray(185, 197))
    : (assertZeroBytes(data.subarray(185, 197), "composite reserved"), null);
  const count = data[119]!;
  if (count < 1 || count > 5) betaError("ACCOUNT_MALFORMED", "composite count out of range");
  const components: MimirCompositeComponentCodec[] = [];
  const seenFeeds = new Set<string>();
  const seenSources = new Set<string>();
  let priorSortKey: string | null = null;
  for (let index = 0; index < count; index += 1) {
    const offset = 229 + index * 80;
    const feed = key(data, offset, "component feed")!;
    const sourceConfig = key(data, offset + 32, "component source")!;
    const quantityX64 = view(data).getBigUint64(offset + 64, true) |
      (view(data).getBigUint64(offset + 72, true) << 64n);
    if (quantityX64 === 0n || seenFeeds.has(feed) || seenSources.has(sourceConfig)) {
      betaError("ACCOUNT_MALFORMED", "duplicate or zero composite component");
    }
    const sortKey = hex(data.subarray(offset, offset + 64));
    if (priorSortKey !== null && priorSortKey >= sortKey) {
      betaError("ACCOUNT_MALFORMED", "composite components not canonical");
    }
    priorSortKey = sortKey;
    seenFeeds.add(feed);
    seenSources.add(sourceConfig);
    components.push({ feed, sourceConfig, quantityX64 });
  }
  assertZeroBytes(data.subarray(229 + count * 80, 629), "unused composite components");
  if (isZeroBytes(data.subarray(128, 160))) betaError("ACCOUNT_MALFORMED", "zero component set hash");
  const dataView = view(data);
  if (data[116] !== 1 || data[117] !== 4 || data[118] !== 0 ||
    dataView.getUint16(120, true) === 0 || dataView.getUint16(122, true) === 0 ||
    dataView.getUint16(124, true) > 10_000 || dataView.getUint16(126, true) > 10_000 ||
    dataView.getBigUint64(160, true) === 0n || dataView.getBigUint64(168, true) === 0n ||
    dataView.getBigUint64(176, true) === 0n) betaError("ACCOUNT_MALFORMED", "composite canonical scalar invalid");
  const identityAsset = version === 1 ? key(data, 629, "identity asset") : null;
  const rawV0 = Uint8Array.from(data.subarray(0, 629));
  view(rawV0).setUint16(8, 0, true);
  view(rawV0).setUint16(10, 629, true);
  rawV0.fill(0, 12, 16);
  rawV0.fill(0, 185, 197);
  return {
    version,
    rawV0,
    feedId: key(data, 16, "composite feed id")!,
    creator: key(data, 48, "composite creator")!,
    quoteMint: key(data, 80, "composite quote mint")!,
    bump: data[184]!,
    components,
    identityAsset,
    ticker,
  };
}

function encodeV1(v0: Uint8Array, identityAsset: Address, ticker: string, target: number): Uint8Array {
  if (v0.length !== target - 32) betaError("INVALID_ARGUMENT", "wrong V0 source length");
  const asset = addressBytes(identityAsset);
  if (isZeroBytes(asset)) betaError("INVALID_ARGUMENT", "zero identity asset");
  const out = new Uint8Array(target);
  out.set(v0);
  view(out).setUint16(8, 1, true);
  view(out).setUint16(10, target, true);
  view(out).setUint32(12, MIMIR_BETA_PRIMARY_TICKER_PRESENT, true);
  out.set(encodeMimirBetaTicker(ticker), target === CLASSIC_V1_LENGTH ? 313 : 185);
  out.set(asset, target - 32);
  return out;
}

export function encodeMimirClassicV1(v0: Uint8Array, identityAsset: Address, ticker: string): Uint8Array {
  decodeClassicConfig(v0, true);
  return encodeV1(v0, identityAsset, ticker, CLASSIC_V1_LENGTH);
}

export function encodeMimirCompositeV1(v0: Uint8Array, identityAsset: Address, ticker: string): Uint8Array {
  decodeCompositeConfig(v0, true);
  return encodeV1(v0, identityAsset, ticker, COMPOSITE_V1_LENGTH);
}

export interface MimirTickerClaim {
  readonly format: 1;
  readonly state: 2;
  readonly bump: number;
  readonly config: Address;
}

export function decodeMimirTickerClaim(data: Uint8Array): MimirTickerClaim {
  if (data.length !== 43 || !bytesEqual(data.subarray(0, 8), utf8("MIMIRTIK")) || data[8] !== 1 || data[9] !== 2) {
    betaError("ACCOUNT_MALFORMED", "ticker claim layout invalid");
  }
  return { format: 1, state: 2, bump: data[10]!, config: key(data, 11, "ticker claim config")! };
}
