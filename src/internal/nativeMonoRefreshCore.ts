import type { Address } from "@solana/kit";
import { sha256 } from "@noble/hashes/sha256";
import { validateFrontier } from "../frontier.js";
import { canonicalAddress, freshNumberRecord } from "./canonicalAuthority.js";
import { decodeMimirSampledSource6Snapshot } from "./sampledTemporalCore.js";
import { decodeMimirCurrentPointSource7Snapshot, MIMIR_CURRENT_POINT_SNAPSHOT_SOURCE_KIND, mimirTemporalModeFromSourceFlags,
  type MimirTemporalMode } from "./currentPointCore.js";
import { SourceDirection } from "../sourceDirection.js";
import type {
  LifecycleFeedConfigHeader, SourceConfigHeader, OracleRegistryHeader,
  SourcingPlanHeader, FeedTwapStateHeader, FeedSnapshotHeader, CompositeSnapshotHeader,
  FeedCollateralLockHeader,
  RaydiumCpmmNativeTwapObservationSample,
  LifecycleFeedTwapSentinel, LifecycleFeedSnapshotSentinel,
} from "../types.js";
import { meteoraDlmmPriceFromCumulativeBinX64, normalizedCpmmNativeTwapPriceX64,
  normalizedDirectQ64PriceX64, normalizedInverseQ64PriceX64 } from "../math.js";
import { isZeroBytes } from "../beta/bytes.js";
import type { Bytes32, FeedConfigHeader, SourceCapEntryV2 } from "../types.js";
import { bytesEqual as eqBytes, utf8, addressBytes, bytesAddress, concatBytes } from "../beta/bytes.js";
import type { DammOnlyBAnchorV1, DammOnlyBIntervalTailV1, SourceObservationRingHeader, SourceObservationRingV1Header, SourceTemporalModuleV1 } from "../types.js";
import type { DammReserveTemporalModuleV3, CpmmQuietTemporalAnchorV2, CpmmQuietTemporalModuleV2 } from "../types.js";
import type { MimirMixedBoundedProofV1 } from "../types.js";
import { Q64, squareQ64ToX64, ratioToX64, pow10U128, meteoraDlmmPriceFromIdX64 } from "../math.js";
import { classifyToken2022Mint, classifyToken2022Vault, type Token2022ClmmAccount } from "../token2022Clmm.js";
import { MIMIR_COND, MIMIR_V1_COND_MASK, MIMIR_V1_POWERS_MASK, MimirSourceConditionedError, readMimirRingStamp, validateDegradedSnapshot, withoutMimirRingStamp } from "../liveness.js";
const SOURCE_RING_V1_HEADER_LEN = 544;
const SOURCE_RING_MAGIC = utf8("MIMIRRNG");
const VERSION_V0 = 0;
const FEED_COLLATERAL_LOCK_HEADER_LEN = 160;
const FEED_COLLATERAL_LOCK_MAGIC = utf8("MIMIRCOL");
const FEED_COLLATERAL_LOCK_OFFSETS = freshNumberRecord("FEED_COLLATERAL_LOCK_OFFSETS");
const FeedCollateralLockStatus = freshNumberRecord("FeedCollateralLockStatus");
const MAX_SOURCE_INDEX = 63;
const CAP_MODEL_ECON_LOSS_BAND_BPS = 50;
const FEE_SOURCE_DLMM_PAIR = 3;
const FEE_SOURCE_POOL_INLINE = 2;
const U64_MAX = (1n << 64n) - 1n;
const M01_PRICE_MAX_X64 = ((1n << 128n) - 1n) / 300n;
const SourceStatus = { Active: 0, Paused: 2 } as const;
export const MIMIR_METEORA_DAMM_V2_ADAPTER_TYPE = 7 as const;
const SourceAdapterType = { RaydiumClmm: 1, RaydiumCpmm: 2, MeteoraDlmm: 3,
  MeteoraDammV2: MIMIR_METEORA_DAMM_V2_ADAPTER_TYPE } as const;
const METEORA_DLMM_PROGRAM = "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo" as Address;
export const METEORA_DLMM_PROGRAMDATA_ADDRESS = "HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu" as Address;
const TOKEN_2022_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" as Address;
const RAYDIUM_CLMM_PROGRAM = canonicalAddress("RAYDIUM_CLMM") as Address;
const RAYDIUM_CLMM_DEVNET_PROGRAM = "DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH" as Address;
const RAYDIUM_CLMM_MAX_TICK = 443_636;
const RAYDIUM_CLMM_POOL_MINT0_OFFSET = 73;
const RAYDIUM_CLMM_POOL_MINT1_OFFSET = 105;
const RAYDIUM_CLMM_POOL_VAULT0_OFFSET = 137;
const RAYDIUM_CLMM_POOL_VAULT1_OFFSET = 169;
const RAYDIUM_CLMM_POOL_MINT0_DECIMALS_OFFSET = 233;
const RAYDIUM_CLMM_POOL_MINT1_DECIMALS_OFFSET = 234;
const RAYDIUM_CLMM_POOL_CURRENT_TICK_OFFSET = 269;
const RAYDIUM_CLMM_OBSERVATION_DISCRIMINATOR = Uint8Array.of(122, 174, 197, 53, 129, 9, 165, 132);
const RAYDIUM_CLMM_OBSERVATION_STATE_LEN = 4_483;
const RAYDIUM_CLMM_OBSERVATION_INITIALIZED_OFFSET = 8;
const RAYDIUM_CLMM_OBSERVATION_INDEX_OFFSET = 17;
const RAYDIUM_CLMM_OBSERVATION_POOL_OFFSET = 19;
const RAYDIUM_CLMM_OBSERVATIONS_OFFSET = 51;
const RAYDIUM_CLMM_OBSERVATION_COUNT = 100;
const RAYDIUM_CLMM_OBSERVATION_STRIDE = 44;
export const RAYDIUM_CLMM_NATIVE_TWAP_MIN_WINDOW_SECS = 120n;
export const RAYDIUM_CPMM_OBSERVATION_MAX_IN_PLACE_SECS = 14n;
export const RAYDIUM_CPMM_NATIVE_TWAP_MIN_ENTRY_SPAN_SECS = 134n;
export const RAYDIUM_CPMM_NATIVE_TWAP_MAX_ENTRY_SPAN_SECS = 1_800n;
const RAYDIUM_CLMM_NATIVE_TWAP_MIN_WRITE_GAP_SECS = 15n;
export const RAYDIUM_CLMM_NATIVE_TWAP_MAX_AGE_SECS = 60n;
export const RAYDIUM_CLMM_NATIVE_TWAP_SELECTION_LOOKBACK_SECS = 195n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;
const U32_MAX = (1n << 32n) - 1n;
const I64_MODULUS = 1n << 64n;
const METEORA_DLMM_POOL_DISCRIMINATOR = Uint8Array.of(33, 11, 49, 98, 181, 101, 177, 13);
const ObservationKind = { Spot: 0, Bucket: 1 } as const;
const isKnownSourceAdapterType = (value: number) => Number.isInteger(value) && value >= 0 && value <= 7;
const bytes32 = (data: Uint8Array, offset: number) => Uint8Array.from(data.subarray(offset, offset + 32));
const view = (data: Uint8Array) => new DataView(data.buffer, data.byteOffset, data.byteLength);
const readU16 = (data: Uint8Array, offset: number) => view(data).getUint16(offset, true);
const readU32 = (data: Uint8Array, offset: number) => view(data).getUint32(offset, true);
const readU64 = (data: Uint8Array, offset: number) => view(data).getBigUint64(offset, true);
export const readU128 = (data: Uint8Array, offset: number) => readU64(data, offset) | (readU64(data, offset + 8) << 64n);
const readI128 = (data: Uint8Array, offset: number) => {
  const value = readU128(data, offset);
  return value >= 1n << 127n ? value - (1n << 128n) : value;
};

const METEORA_DLMM_ORACLE_DISCRIMINATOR = Uint8Array.of(139, 194, 131, 179, 140, 179, 229, 244);
const METEORA_DLMM_ORACLE_HEADER_LEN = 32;
const METEORA_DLMM_ORACLE_SAMPLE_LEN = 32;
const METEORA_DLMM_ORACLE_MAX_READ_SAMPLES = 128;
const METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS_BIGINT = 240n;
const METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS_BIGINT = 60n;
const METEORA_DLMM_NATIVE_MAX_CREATION_GAP_SECS_BIGINT = 120n;
const METEORA_DLMM_NATIVE_MAX_RECORD_SPAN_SECS_BIGINT = 120n;
export const ACCEPTED_METEORA_DLMM_DEPLOYMENT_UNIX = 1780470187n;
export const METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS = Number(METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS_BIGINT);
export const METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS = Number(METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS_BIGINT);

export interface MeteoraDlmmNativeTwapSample {
  oldTimestamp: bigint;
  newTimestamp: bigint;
  oldCumulativeBin: bigint;
  newCumulativeBin: bigint;
}

export type MimirNativeTwapUnavailableReason = "stale-oracle" | "interval-too-sparse" | "history-too-short" | "missing-oracle";

export class MimirNativeTwapUnavailableError extends Error {
  constructor(readonly adapter: "meteora-dlmm" | "raydium-clmm" | "raydium-cpmm", readonly reason: MimirNativeTwapUnavailableReason,
    readonly timestamps: Readonly<{ latestUnixTs: bigint | null; olderUnixTs: bigint | null; currentUnixTs: bigint | null;
      /** DLMM: the oldest update of the history connected to the latest record (after the last gap). */
      connectedUnixTs?: bigint }>,
    message: string) {
    super(message);
    this.name = "MimirNativeTwapUnavailableError";
  }
}

export class MimirNativeObservationUnavailableError extends Error {
  readonly code = "MimirNativeObservationUnavailable";
  constructor(readonly feedId: Uint8Array, readonly sourceIndex: number, readonly adapter: MimirNativeTwapUnavailableError["adapter"],
    readonly reason: MimirNativeTwapUnavailableReason, readonly timestamps: MimirNativeTwapUnavailableError["timestamps"]) {
    super(`Mimir ${adapter} source ${sourceIndex} native TWAP unavailable (${reason}).`);
  }
}

// Byte parsing only; omission makes no freshness claim. The caller authenticates owner, PDA, pool identity, and freshness.
// With `currentTimestamp`, a 60–120 s old latest record is extended to now with `activeId` (the LbPair active bin), as the program does; without `activeId` it throws `stale-oracle`.
export function extractMeteoraDlmmNativeTwapSample(params: {
  oracleData: Uint8Array;
  currentTimestamp?: bigint;
  activeId?: number;
  cluster?: MimirGenerationCluster;
}): MeteoraDlmmNativeTwapSample {

  const data = new Uint8Array(params.oracleData.buffer, params.oracleData.byteOffset, params.oracleData.byteLength);
  const currentTimestamp = params.currentTimestamp;
  const deploymentUnix = mimirVenueDeploymentUnix(params.cluster).dlmm;
  if (data.length < METEORA_DLMM_ORACLE_HEADER_LEN ||
      !eqBytes(data.subarray(0, 8), METEORA_DLMM_ORACLE_DISCRIMINATOR) ||
      (currentTimestamp !== undefined && (typeof currentTimestamp !== "bigint" || currentTimestamp < 0n || currentTimestamp > U64_MAX))) {
    throw new Error("InvalidMeteoraDlmmOracleState");
  }
  const latestIndex = readU64(data, 8);
  const activeSize = readU64(data, 16);
  const length = readU64(data, 24);
  const maxSafeLength = BigInt(Math.floor((Number.MAX_SAFE_INTEGER - METEORA_DLMM_ORACLE_HEADER_LEN) /
    METEORA_DLMM_ORACLE_SAMPLE_LEN));
  if (length > maxSafeLength || data.length !== METEORA_DLMM_ORACLE_HEADER_LEN + Number(length) * METEORA_DLMM_ORACLE_SAMPLE_LEN ||
      activeSize === 0n || activeSize > length || latestIndex >= activeSize) {
    throw new Error("InvalidMeteoraDlmmOracleState");
  }
  const entry = (index: bigint) => {
    const offset = METEORA_DLMM_ORACLE_HEADER_LEN + Number(index) * METEORA_DLMM_ORACLE_SAMPLE_LEN;
    return { cumulative: readI128(data, offset), created: readU64(data, offset + 16), updated: readU64(data, offset + 24) };
  };
  const latest = entry(latestIndex);
  const unavailable = (reason: MimirNativeTwapUnavailableReason, olderUnixTs: bigint | null, connectedUnixTs?: bigint) =>
    new MimirNativeTwapUnavailableError("meteora-dlmm", reason,
      { latestUnixTs: latest.updated, olderUnixTs, currentUnixTs: currentTimestamp ?? null, ...(connectedUnixTs === undefined ? {} : { connectedUnixTs }) }, "InvalidTwapState");
  if (latest.created === 0n) throw unavailable("history-too-short", null);
  if (latest.updated < latest.created || (currentTimestamp !== undefined && latest.updated > currentTimestamp)) {
    throw new Error("InvalidTwapState");
  }
  if (latest.updated - latest.created >= METEORA_DLMM_NATIVE_MAX_RECORD_SPAN_SECS_BIGINT) throw unavailable("interval-too-sparse", null);
  const tail = currentTimestamp === undefined ? 0n : currentTimestamp - latest.updated;
  if (tail > METEORA_DLMM_NATIVE_MAX_CREATION_GAP_SECS_BIGINT) throw unavailable("stale-oracle", null);
  const extended = tail > METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS_BIGINT;
  if (extended && params.activeId === undefined) throw unavailable("stale-oracle", null);
  const endTimestamp = extended ? currentTimestamp! : latest.updated;
  const endCumulative = extended ? latest.cumulative + BigInt(params.activeId!) * tail : latest.cumulative;
  let newerTimestamp = latest.updated;
  let newerCreated = latest.created;
  const maxWalk = Number(activeSize < BigInt(METEORA_DLMM_ORACLE_MAX_READ_SAMPLES)
    ? activeSize : BigInt(METEORA_DLMM_ORACLE_MAX_READ_SAMPLES));
  for (let distance = 1; distance < maxWalk; distance += 1) {
    const distanceBigInt = BigInt(distance);
    const index = latestIndex >= distanceBigInt ? latestIndex - distanceBigInt : activeSize - (distanceBigInt - latestIndex);
    const old = entry(index);
    if (old.created === 0n) throw unavailable("history-too-short", null);
    if (old.updated < old.created || old.updated >= newerTimestamp) throw new Error("InvalidTwapState");
    if (old.updated - old.created >= METEORA_DLMM_NATIVE_MAX_RECORD_SPAN_SECS_BIGINT) throw unavailable("interval-too-sparse", old.updated);
    if (newerCreated <= old.updated) throw new Error("InvalidTwapState");
    if (newerCreated - old.updated > METEORA_DLMM_NATIVE_MAX_CREATION_GAP_SECS_BIGINT) throw unavailable("interval-too-sparse", old.updated, newerTimestamp);
    if (endTimestamp - old.updated >= METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS_BIGINT) {
      if (old.updated <= deploymentUnix) throw unavailable("history-too-short", old.updated);
      const delta = endCumulative - old.cumulative;
      if (delta < -(1n << 127n) || delta > (1n << 127n) - 1n) throw new Error("ArithmeticOverflow");
      return { oldTimestamp: old.updated, newTimestamp: endTimestamp,
        oldCumulativeBin: old.cumulative, newCumulativeBin: endCumulative };
    }
    newerTimestamp = old.updated;
    newerCreated = old.created;
  }
  throw unavailable("history-too-short", newerTimestamp, newerTimestamp);
}

/** Closed DUAL readiness of a Meteora DLMM oracle (program `classify_dlmm_dual_readiness`); every program error is `INVALID`, never a fallback. */
export type MeteoraDlmmDualReadiness = "ready" | "STALE" | "INSUFFICIENT" | "GAP" | "INVALID";
export function classifyMeteoraDlmmDualReadiness(data: Uint8Array, now: bigint, cluster?: MimirGenerationCluster): MeteoraDlmmDualReadiness {
  const H = METEORA_DLMM_ORACLE_HEADER_LEN; const S = METEORA_DLMM_ORACLE_SAMPLE_LEN;
  if (data.length < H || !eqBytes(data.subarray(0, 8), METEORA_DLMM_ORACLE_DISCRIMINATOR)) return "INVALID";
  const latestIndex = readU64(data, 8); const activeSize = readU64(data, 16); const length = readU64(data, 24);
  if (BigInt(data.length) !== BigInt(H) + length * BigInt(S)) return "INVALID";
  if (latestIndex === 0n && activeSize === 0n && length >= 1n && data.subarray(H, H + S).every((b) => b === 0)) return "INSUFFICIENT";
  if (activeSize === 0n || activeSize > length || latestIndex >= activeSize || now < 0n) return "INVALID";
  const entry = (index: bigint) => { const o = H + Number(index) * S; return { created: readU64(data, o + 16), updated: readU64(data, o + 24) }; };
  const latest = entry(latestIndex);
  if (latest.created === 0n || latest.updated < latest.created || latest.updated - latest.created >= METEORA_DLMM_NATIVE_MAX_RECORD_SPAN_SECS_BIGINT ||
      latest.updated > now) return "INVALID";
  if (now - latest.updated > METEORA_DLMM_NATIVE_MAX_CREATION_GAP_SECS_BIGINT) return "STALE";
  const end = now - latest.updated > METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS_BIGINT ? now : latest.updated;
  const maxWalk = activeSize < BigInt(METEORA_DLMM_ORACLE_MAX_READ_SAMPLES) ? activeSize : BigInt(METEORA_DLMM_ORACLE_MAX_READ_SAMPLES);
  let newerUpdated = latest.updated; let newerCreated = latest.created;
  for (let d = 1n; d < maxWalk; d += 1n) {
    const old = entry(latestIndex >= d ? latestIndex - d : activeSize - (d - latestIndex));
    if (old.created === 0n || old.updated < old.created || old.updated >= newerUpdated ||
        old.updated - old.created >= METEORA_DLMM_NATIVE_MAX_RECORD_SPAN_SECS_BIGINT || newerCreated <= old.updated) return "INVALID";
    if (newerCreated - old.updated > METEORA_DLMM_NATIVE_MAX_CREATION_GAP_SECS_BIGINT) return "GAP";
    if (end - old.updated >= METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS_BIGINT) {
      return old.updated <= mimirVenueDeploymentUnix(cluster).dlmm ? "INVALID" : "ready";
    }
    newerUpdated = old.updated; newerCreated = old.created;
  }
  return "INSUFFICIENT";
}

/**
 * Computes a DLMM TWAP from bytes and canonical decoded feed/source headers.
 * The caller authenticates account owners, PDAs, coherent input accounts, and sample freshness; this result alone does not prove actionability.
 */
function requireUnconditionedToken2022(mint: Token2022ClmmAccount, vault: Token2022ClmmAccount, expectedVault: Address,
  decimals: number, authority: Address, nowUnix: bigint): void {
  const mintClass = classifyToken2022Mint({ account: mint, expectedMint: mint.address, expectedDecimals: decimals, nowUnix });
  const vaultClass = classifyToken2022Vault({ account: vault, expectedVault, expectedMint: mint.address,
    expectedAuthority: authority, mintPolicy: mintClass.policy });
  const conditions = mintClass.conditions | vaultClass.conditions;
  if (conditions !== 0) throw new MimirSourceConditionedError(conditions, mintClass.mask);
  if (vaultClass.amount === 0n) throw new Error("InvalidToken2022VaultReserve");
}

export function computeMeteoraDlmmNativeTwapPriceX64(params: Parameters<typeof computeMeteoraDlmmNativeTwapQuality>[0]): bigint {
  return computeMeteoraDlmmNativeTwapQuality(params).priceX64;
}

export function computeMeteoraDlmmNativeTwapQuality(params: {
  poolStateData: Uint8Array;
  sourceConfig: SourceConfigHeader;
  feedConfig: FeedConfigHeader;
  sample: MeteoraDlmmNativeTwapSample;
  token2022MintAccount?: Token2022ClmmAccount;
  token2022SelectedVaultAccount?: Token2022ClmmAccount;
  nowTimestamp?: bigint;
}): MimirNativeTwapQuality {
  const data = new Uint8Array(params.poolStateData.buffer, params.poolStateData.byteOffset, params.poolStateData.byteLength);
  const { sourceConfig: source, feedConfig: feed, sample } = params;
  if (data.length !== 904 || !eqBytes(data.subarray(0, 8), METEORA_DLMM_POOL_DISCRIMINATOR)) {
    throw new Error("InvalidMeteoraDlmmPoolState");
  }
  if (source.adapterType !== SourceAdapterType.MeteoraDlmm ||
      source.direction !== SourceDirection.QuotePerBase ||
      !eqBytes(source.programId, addressBytes(METEORA_DLMM_PROGRAM))) {
    throw new Error("InvalidMeteoraDlmmSourceConfig");
  }
  const binStep = readU16(data, 80);
  if (binStep < 1 || binStep > 400) throw new Error("InvalidMeteoraDlmmPoolState");
  const tokenX = data.subarray(88, 120), tokenY = data.subarray(120, 152);
  const reserveX = data.subarray(152, 184), reserveY = data.subarray(184, 216);
  const xIsBase = eqBytes(tokenX, source.baseMint) && eqBytes(tokenY, source.quoteMint) &&
    eqBytes(reserveX, source.baseVault) && eqBytes(reserveY, source.quoteVault);
  const yIsBase = eqBytes(tokenY, source.baseMint) && eqBytes(tokenX, source.quoteMint) &&
    eqBytes(reserveY, source.baseVault) && eqBytes(reserveX, source.quoteVault);
  if ((!xIsBase && !yIsBase) || !eqBytes(source.baseMint, feed.baseMint) || !eqBytes(source.quoteMint, feed.quoteMint)) {
    throw new Error("InvalidMeteoraDlmmSourcePair");
  }
  let economicBinding: { selectedBase: boolean; multiplierQ64: bigint } | undefined;
  if (source.adapterVersion === 1) {
    const mint = params.token2022MintAccount, vault = params.token2022SelectedVaultAccount;
    if (!mint || !vault || typeof params.nowTimestamp !== "bigint" || params.nowTimestamp < 0n ||
        params.nowTimestamp > U32_MAX || mint.data.length <= 82 || !eqBytes(source.tokenProgram, addressBytes(TOKEN_2022_PROGRAM)) ||
        (mint.address !== bytesAddress(source.baseMint) && mint.address !== bytesAddress(source.quoteMint))) {
      throw new Error("InvalidMeteoraDlmmToken2022Binding");
    }
    const selectedBase = mint.address === bytesAddress(source.baseMint);
    const expectedVault = bytesAddress(selectedBase ? source.baseVault : source.quoteVault);
    const decimals = selectedBase ? feed.baseDecimals : feed.quoteDecimals;
    if (mint.owner !== TOKEN_2022_PROGRAM || vault.address !== expectedVault || vault.owner !== TOKEN_2022_PROGRAM) {
      throw new Error("InvalidMeteoraDlmmToken2022Binding");
    }
    requireUnconditionedToken2022(mint, vault, expectedVault, decimals, bytesAddress(source.vaultAuthority), params.nowTimestamp);
    economicBinding = { selectedBase, multiplierQ64: token2022ScaledUiMultiplierQ64(mint.data, params.nowTimestamp) };
  } else if (source.adapterVersion !== VERSION_V0 || params.token2022MintAccount !== undefined ||
      params.token2022SelectedVaultAccount !== undefined) {
    throw new Error("InvalidMeteoraDlmmToken2022Binding");
  }
  const { oldTimestamp, newTimestamp, oldCumulativeBin, newCumulativeBin } = sample;
  const i128Min = -(1n << 127n), i128Max = (1n << 127n) - 1n;
  if ([oldTimestamp, newTimestamp, oldCumulativeBin, newCumulativeBin].some((value) => typeof value !== "bigint") ||
      oldTimestamp < 0n || newTimestamp > U64_MAX || newTimestamp <= oldTimestamp ||
      oldCumulativeBin < i128Min || oldCumulativeBin > i128Max ||
      newCumulativeBin < i128Min || newCumulativeBin > i128Max) {
    throw new Error("InvalidMeteoraDlmmNativeTwapSample");
  }
  const window = newTimestamp - oldTimestamp;
  const cumulativeDelta = newCumulativeBin - oldCumulativeBin;
  if (window < METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS_BIGINT || cumulativeDelta < i128Min || cumulativeDelta > i128Max ||
      cumulativeDelta < -443_636n * window || cumulativeDelta > 443_636n * window) {
    throw new Error("InvalidMeteoraDlmmNativeTwapSample");
  }
  const economic = (raw: bigint) => {
    const normalized = xIsBase ? normalizedDirectQ64PriceX64(raw, feed.baseDecimals, feed.quoteDecimals)
      : normalizedInverseQ64PriceX64(raw, feed.baseDecimals, feed.quoteDecimals);
    return economicBinding ? token2022EconomicPriceX64(normalized, economicBinding.selectedBase, economicBinding.multiplierQ64) : normalized;
  };
  const priceX64 = economic(meteoraDlmmPriceFromCumulativeBinX64(cumulativeDelta, window, binStep));
  const spotX64 = economic(meteoraDlmmPriceFromIdX64(view(data).getInt32(76, true), binStep));
  return nativeTwapQuality(priceX64, spotX64, Math.min(binStep, 10_000), feed.maxConfidenceBps, "DispersionTooWide");
}

const RING_OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  flags: 12,
  feedId: 16,
  sourceIndex: 48,
  status: 49,
  ringVersion: 50,
  adapterType: 52,
  observationKind: 53,
  sampleCount: 54,
  capacity: 56,
  head: 58,
  minSlotGap: 60,
  newestSlot: 64,
  oldestSlot: 72,
  lastActivitySlot: 80,
  lastPriceX64: 88,
  lastConfidenceBps: 104,
  lastSpreadBps: 106,
  lastDepthTo50BpsNative: 112,
  lastLiquidityNative: 128,
  cumulativePriceX64: 144,
  cumulativeSlotDelta: 160,
  sourceConfigRevision: 168,
  sourceSetRevision: 176,
  lastObservationHash: 184,
  sourceConfig: 216,
  poolOrMarket: 248,
  selectedPlanHash: 280,
  bump: 312,
  lastEconLossFloorNative: 320,
  lastCapitalRequiredFloorNative: 336,
  lastFeeRatePpm: 352,
  econLossBandBps: 360,
  sourceWeightBps: 362,
  routeCorrelationGroup: 364,
  capModelFlags: 366,
  feeSource: 368,
  windowFlags: 369,
  activeMaxConfidenceBps: 370,
  activeMaxSpreadBps: 372,
  activeCapModelFlags: 374,
  completedMaxConfidenceBps: 376,
  completedMaxSpreadBps: 378,
  completedCapModelFlags: 380,
  v1Reserved: 382,
  activeMinDepthTo50BpsNative: 384,
  activeMinLiquidityNative: 400,
  activeMinEconLossFloorNative: 416,
  activeMinCapitalRequiredFloorNative: 432,
  completedEndSlot: 448,
  completedActivitySlot: 456,
  completedPriceX64: 464,
  completedMinDepthTo50BpsNative: 480,
  completedMinLiquidityNative: 496,
  completedMinEconLossFloorNative: 512,
  completedMinCapitalRequiredFloorNative: 528,
} as const;

const DAMM_ONLYB_SQRT_PRICE_MAX = 79226673521066979257578248091n;

export const SOURCE_TEMPORAL_MODULE_V1 = Object.freeze({
  abiVersion: 1,
  headerLen: 256,
  adapterType: 7,
  proofKind: 1,
  minimumSpanSeconds: 120n,
  lastModuleRefreshSlotOffset: 8,
  tailOffset: 16,
  proofKindOffset: 16,
  flagsOffset: 18,
  reservedOffset: 20,
  contextHashOffset: 24,
  lastObservationUnixTsOffset: 56,
  anchorOffset: 64,
  pendingAnchorOffset: 136,
  lowerX64Offset: 208,
  upperX64Offset: 224,
  endSlotOffset: 240,
  endUnixTsOffset: 248,
  anchorLen: 72,
  presenceA: 1,
  presenceB: 2,
  presenceQ: 4,
  invalidated: 8,
} as const);
export const CPMM_QUIET_TEMPORAL_MODULE_V2 = Object.freeze({
  magic: "MTP2",
  abiVersion: 2,
  headerLen: 192,
  kind: 2,
  requiredSecs: 120n,
  flagA: 1,
  flagB: 2,
  flagQ: 4,
  flagInvalidated: 8,
  ringNewestSlotOffset: 8,
  kindOffset: 16,
  flagsOffset: 18,
  reservedOffset: 20,
  contextHashOffset: 24,
  lastRefreshUnixTsOffset: 56,
  anchorAOffset: 64,
  anchorBOffset: 112,
  qLowerX64Offset: 160,
  qUpperX64Offset: 176,
  anchorLen: 48,
} as const);
// Kept as a name-only export bridge; the value describes the 256-byte module.
export const SOURCE_RING_DAMM_ONLYB_V1 = SOURCE_TEMPORAL_MODULE_V1;

export function decodeMimirBrowserSourceRingFields(data: Uint8Array): SourceObservationRingHeader {
  return {
    feedId: bytes32(data, RING_OFFSETS.feedId),
    sourceIndex: data[RING_OFFSETS.sourceIndex],
    status: data[RING_OFFSETS.status],
    ringVersion: readU16(data, RING_OFFSETS.ringVersion),
    adapterType: data[RING_OFFSETS.adapterType],
    observationKind: data[RING_OFFSETS.observationKind],
    sampleCount: readU16(data, RING_OFFSETS.sampleCount),
    capacity: readU16(data, RING_OFFSETS.capacity),
    head: readU16(data, RING_OFFSETS.head),
    minSlotGap: readU16(data, RING_OFFSETS.minSlotGap),
    newestSlot: readU64(data, RING_OFFSETS.newestSlot),
    oldestSlot: readU64(data, RING_OFFSETS.oldestSlot),
    lastActivitySlot: readU64(data, RING_OFFSETS.lastActivitySlot),
    lastPriceX64: readU128(data, RING_OFFSETS.lastPriceX64),
    lastConfidenceBps: readU16(data, RING_OFFSETS.lastConfidenceBps),
    lastSpreadBps: readU16(data, RING_OFFSETS.lastSpreadBps),
    lastDepthTo50BpsNative: readU128(data, RING_OFFSETS.lastDepthTo50BpsNative),
    lastLiquidityNative: readU128(data, RING_OFFSETS.lastLiquidityNative),
    cumulativePriceX64: readU128(data, RING_OFFSETS.cumulativePriceX64),
    cumulativeSlotDelta: readU64(data, RING_OFFSETS.cumulativeSlotDelta),
    sourceConfigRevision: readU64(data, RING_OFFSETS.sourceConfigRevision),
    sourceSetRevision: readU64(data, RING_OFFSETS.sourceSetRevision),
    lastObservationHash: bytes32(data, RING_OFFSETS.lastObservationHash),
    sourceConfig: bytes32(data, RING_OFFSETS.sourceConfig),
    poolOrMarket: bytes32(data, RING_OFFSETS.poolOrMarket),
    selectedPlanHash: bytes32(data, RING_OFFSETS.selectedPlanHash),
    bump: data[RING_OFFSETS.bump],
    lastEconLossFloorNative: readU128(
      data,
      RING_OFFSETS.lastEconLossFloorNative,
    ),
    lastCapitalRequiredFloorNative: readU128(
      data,
      RING_OFFSETS.lastCapitalRequiredFloorNative,
    ),
    lastFeeRatePpm: readU64(data, RING_OFFSETS.lastFeeRatePpm),
    econLossBandBps: readU16(data, RING_OFFSETS.econLossBandBps),
    sourceWeightBps: readU16(data, RING_OFFSETS.sourceWeightBps),
    routeCorrelationGroup: readU16(data, RING_OFFSETS.routeCorrelationGroup),
    capModelFlags: readU16(data, RING_OFFSETS.capModelFlags),
    feeSource: data[RING_OFFSETS.feeSource],
  };
}

function decodeDammCommonTail(data: Uint8Array, ring: SourceObservationRingV1Header, proofKind: number): Omit<DammOnlyBIntervalTailV1, "kind"> {
  const o = SOURCE_TEMPORAL_MODULE_V1;
  const flags = readU16(data, o.flagsOffset);
  const contextHash = bytes32(data, o.contextHashOffset);
  const lastObservationUnixTs = readI64(data, o.lastObservationUnixTsOffset);
  const anchor = (offset: number): DammOnlyBAnchorV1 => ({
    slot: readU64(data, offset),
    unixTs: readI64(data, offset + 8),
    sqrtPrice: readU128(data, offset + 16),
    lpBCumulative: readU128(data, offset + 32),
    protocolBCumulative: readU64(data, offset + 48),
    permanentK: readU128(data, offset + 56),
  });
  const validAnchor = (value: DammOnlyBAnchorV1) => value.slot > 0n && value.unixTs >= 0n &&
    value.sqrtPrice > 0n && value.sqrtPrice <= DAMM_ONLYB_SQRT_PRICE_MAX && value.permanentK > 0n;
  if (readU16(data, o.proofKindOffset) !== proofKind || (flags & ~15) !== 0 ||
      (flags & o.presenceA) === 0 || eqBytes(contextHash, new Uint8Array(32)) || lastObservationUnixTs < 0n ||
      data.subarray(o.reservedOffset, o.contextHashOffset).some(Boolean)) {
    throw new Error("InvalidSourceRing");
  }
  const serving = anchor(o.anchorOffset);
  if (!validAnchor(serving) || serving.slot > ring.newestSlot || serving.unixTs > lastObservationUnixTs) {
    throw new Error("InvalidSourceRing");
  }
  const hasPending = (flags & o.presenceB) !== 0;
  const pendingBytes = data.subarray(o.pendingAnchorOffset, o.lowerX64Offset);
  let pendingAnchor: DammOnlyBAnchorV1 | null = null;
  if (hasPending) {
    pendingAnchor = anchor(o.pendingAnchorOffset);
    if (!validAnchor(pendingAnchor) || pendingAnchor.slot <= serving.slot || pendingAnchor.unixTs <= serving.unixTs ||
        pendingAnchor.slot > ring.newestSlot || pendingAnchor.unixTs > lastObservationUnixTs) {
      throw new Error("InvalidSourceRing");
    }
  } else if (pendingBytes.some(Boolean)) {
    throw new Error("InvalidSourceRing");
  }
  const hasPublication = (flags & o.presenceQ) !== 0;
  const publicationBytes = data.subarray(o.lowerX64Offset, o.headerLen);
  let publication: DammOnlyBIntervalTailV1["publication"] = null;
  if (hasPublication) {
    const lowerX64 = readU128(data, o.lowerX64Offset);
    const upperX64 = readU128(data, o.upperX64Offset);
    const endSlot = readU64(data, o.endSlotOffset);
    const endUnixTs = readI64(data, o.endUnixTsOffset);
    if (lowerX64 === 0n || lowerX64 > upperX64 || endSlot <= serving.slot || endSlot > ring.newestSlot ||
        endUnixTs < 0n || endUnixTs - serving.unixTs < o.minimumSpanSeconds || endUnixTs > lastObservationUnixTs) {
      throw new Error("InvalidSourceRing");
    }
    publication = {
      lowerX64, upperX64, startSlot: serving.slot, startUnixTs: serving.unixTs,
      endSlot, endUnixTs, revision: endSlot,
    };
  } else if (publicationBytes.some(Boolean)) {
    throw new Error("InvalidSourceRing");
  }
  return {
    contextHash,
    lastObservationUnixTs,
    invalidated: (flags & o.invalidated) !== 0,
    anchor: serving,
    pendingAnchor,
    publication,
  };
}

function decodeMimirBrowserSourceRingV1WithDammTail(input: Uint8Array): {
  ring: SourceObservationRingV1Header;
  dammOnlyBTail: DammOnlyBIntervalTailV1 | null;
} {
  const stamped = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const stamp = stamped.length === SOURCE_RING_V1_HEADER_LEN ? readMimirRingStamp(stamped) : undefined;
  const data = stamp ? withoutMimirRingStamp(stamped) : stamped;
  const legacy = data.length === SOURCE_RING_V1_HEADER_LEN &&
    eqBytes(data.subarray(RING_OFFSETS.magic, RING_OFFSETS.magic + 8), SOURCE_RING_MAGIC) &&
    readU16(data, RING_OFFSETS.version) === VERSION_V0 &&
    readU16(data, RING_OFFSETS.headerLen) === SOURCE_RING_V1_HEADER_LEN;
  if (!legacy) {
    throw new Error("InvalidAccountData");
  }
  const common = decodeMimirBrowserSourceRingFields(data);
  const ring: SourceObservationRingV1Header = {
    ...common,
    stamp,
    windowFlags: data[RING_OFFSETS.windowFlags],
    activeMaxConfidenceBps: readU16(data, RING_OFFSETS.activeMaxConfidenceBps),
    activeMaxSpreadBps: readU16(data, RING_OFFSETS.activeMaxSpreadBps),
    activeCapModelFlags: readU16(data, RING_OFFSETS.activeCapModelFlags),
    completedMaxConfidenceBps: readU16(data, RING_OFFSETS.completedMaxConfidenceBps),
    completedMaxSpreadBps: readU16(data, RING_OFFSETS.completedMaxSpreadBps),
    completedCapModelFlags: readU16(data, RING_OFFSETS.completedCapModelFlags),
    activeMinDepthTo50BpsNative: readU128(data, RING_OFFSETS.activeMinDepthTo50BpsNative),
    activeMinLiquidityNative: readU128(data, RING_OFFSETS.activeMinLiquidityNative),
    activeMinEconLossFloorNative: readU128(data, RING_OFFSETS.activeMinEconLossFloorNative),
    activeMinCapitalRequiredFloorNative: readU128(data, RING_OFFSETS.activeMinCapitalRequiredFloorNative),
    completedEndSlot: readU64(data, RING_OFFSETS.completedEndSlot),
    completedActivitySlot: readU64(data, RING_OFFSETS.completedActivitySlot),
    completedPriceX64: readU128(data, RING_OFFSETS.completedPriceX64),
    completedMinDepthTo50BpsNative: readU128(data, RING_OFFSETS.completedMinDepthTo50BpsNative),
    completedMinLiquidityNative: readU128(data, RING_OFFSETS.completedMinLiquidityNative),
    completedMinEconLossFloorNative: readU128(data, RING_OFFSETS.completedMinEconLossFloorNative),
    completedMinCapitalRequiredFloorNative: readU128(data, RING_OFFSETS.completedMinCapitalRequiredFloorNative),
  };
  const adapterIsValid = isKnownSourceAdapterType(ring.adapterType) && ring.adapterType !== 5;
  if (ring.status === SourceStatus.Paused) {
    if (ring.ringVersion !== 1 || !adapterIsValid || ring.observationKind !== ObservationKind.Spot || ring.sourceIndex > MAX_SOURCE_INDEX ||
        data.subarray(12, RING_OFFSETS.feedId).some(Boolean) || data.subarray(RING_OFFSETS.sampleCount, RING_OFFSETS.sourceConfigRevision).some(Boolean) ||
        data.subarray(RING_OFFSETS.lastObservationHash, RING_OFFSETS.sourceConfig).some(Boolean) ||
        data.subarray(RING_OFFSETS.bump + 1, RING_OFFSETS.sourceWeightBps).some(Boolean) ||
        data.subarray(RING_OFFSETS.capModelFlags, SOURCE_RING_V1_HEADER_LEN).some(Boolean) ||
        eqBytes(ring.feedId, new Uint8Array(32)) || ring.sourceConfigRevision === 0n || ring.sourceSetRevision === 0n ||
        eqBytes(ring.sourceConfig, new Uint8Array(32)) || eqBytes(ring.poolOrMarket, new Uint8Array(32)) ||
        eqBytes(ring.selectedPlanHash, new Uint8Array(32)) || ring.sourceWeightBps === 0 || ring.sourceWeightBps > 10_000) {
      throw new Error("InvalidSourceRing");
    }
    return { ring, dammOnlyBTail: null };
  }
  const pointOnly = readU32(data, 12) === 1 && (ring.adapterType === 3 || ring.adapterType === 4 || ring.adapterType === 6);
  const economic = (value: bigint) => pointOnly ? value !== 0n : value === 0n;
  const ready = (ring.windowFlags & 1) !== 0;
  const authenticated = (ring.windowFlags & 2) !== 0;
  const authenticatedAdapterAllowed = ring.adapterType === SourceAdapterType.RaydiumCpmm ||
    ring.adapterType === SourceAdapterType.MeteoraDlmm || ring.adapterType === SourceAdapterType.RaydiumClmm;
  const activeEmpty = ring.cumulativeSlotDelta === 0n;
  const activeEnd = ring.oldestSlot + ring.cumulativeSlotDelta;
  const activeZero = ring.cumulativePriceX64 === 0n && ring.activeMinDepthTo50BpsNative === 0n &&
    ring.activeMinLiquidityNative === 0n && ring.activeMinEconLossFloorNative === 0n &&
    ring.activeMinCapitalRequiredFloorNative === 0n && ring.activeMaxConfidenceBps === 0 &&
    ring.activeMaxSpreadBps === 0 && ring.activeCapModelFlags === 0;
  const completedZero = ring.completedEndSlot === 0n && ring.completedActivitySlot === 0n &&
    ring.completedPriceX64 === 0n && ring.completedMinDepthTo50BpsNative === 0n &&
    ring.completedMinLiquidityNative === 0n && ring.completedMinEconLossFloorNative === 0n &&
    ring.completedMinCapitalRequiredFloorNative === 0n && ring.completedMaxConfidenceBps === 0 &&
    ring.completedMaxSpreadBps === 0 && ring.completedCapModelFlags === 0;
  if (ring.ringVersion !== 1 || ring.status !== SourceStatus.Active || !adapterIsValid || ring.observationKind !== ObservationKind.Spot ||
      ring.sourceIndex > MAX_SOURCE_INDEX || ring.sampleCount === 0 || ring.capacity === 0 || ring.sampleCount > ring.capacity ||
      ring.oldestSlot > ring.newestSlot || ring.lastActivitySlot > ring.newestSlot || ring.lastPriceX64 === 0n ||
      ring.lastConfidenceBps > 10_000 || ring.lastSpreadBps > 10_000 || ring.lastDepthTo50BpsNative === 0n ||
      ring.lastLiquidityNative === 0n || ring.sourceConfigRevision === 0n || ring.sourceSetRevision === 0n ||
      eqBytes(ring.lastObservationHash, new Uint8Array(32)) || eqBytes(ring.sourceConfig, new Uint8Array(32)) ||
      eqBytes(ring.poolOrMarket, new Uint8Array(32)) || eqBytes(ring.selectedPlanHash, new Uint8Array(32)) ||
      economic(ring.lastEconLossFloorNative) || economic(ring.lastCapitalRequiredFloorNative) || (!pointOnly && ring.lastFeeRatePpm === 0n) ||
      ring.lastFeeRatePpm > 1_000_000n || ring.econLossBandBps !== (pointOnly ? 0 : CAP_MODEL_ECON_LOSS_BAND_BPS) ||
      ring.sourceWeightBps === 0 || ring.sourceWeightBps > 10_000 || ring.feeSource > FEE_SOURCE_DLMM_PAIR ||
      data.subarray(pointOnly ? 16 : 12, RING_OFFSETS.feedId).some(Boolean) || (pointOnly && (ring.windowFlags !== 1 || ring.sampleCount !== 1 || ring.cumulativeSlotDelta !== 0n || ring.completedEndSlot !== ring.newestSlot)) || data.subarray(RING_OFFSETS.minSlotGap + 2, RING_OFFSETS.newestSlot).some(Boolean) ||
      data.subarray(RING_OFFSETS.lastSpreadBps + 2, RING_OFFSETS.lastDepthTo50BpsNative).some(Boolean) ||
      data.subarray(RING_OFFSETS.bump + 1, RING_OFFSETS.lastEconLossFloorNative).some(Boolean) ||
      ring.capacity !== 300 || ring.head !== 0 ||
      (pointOnly ? ring.minSlotGap > 1 : ring.minSlotGap !== 1) || ring.sampleCount > 300 || activeEnd > U64_MAX || activeEnd !== ring.newestSlot ||
      ring.cumulativeSlotDelta >= 300n || ring.lastPriceX64 > M01_PRICE_MAX_X64 || ring.capModelFlags !== 0 ||
      (ring.windowFlags & ~7) !== 0 || (authenticated && (!ready || !authenticatedAdapterAllowed)) ||
      ((ring.windowFlags & 4) !== 0 && (!authenticated || ring.adapterType !== SourceAdapterType.RaydiumCpmm)) ||
      ring.activeMaxConfidenceBps > 10_000 || ring.activeMaxSpreadBps > 10_000 || ring.activeCapModelFlags !== 0 ||
      ring.completedMaxConfidenceBps > 10_000 || ring.completedMaxSpreadBps > 10_000 || ring.completedCapModelFlags !== 0 ||
      data.subarray(RING_OFFSETS.v1Reserved, RING_OFFSETS.activeMinDepthTo50BpsNative).some(Boolean) ||
      (activeEmpty ? (!activeZero || ring.sampleCount !== 1) :
        (ring.cumulativePriceX64 === 0n || ring.activeMinDepthTo50BpsNative === 0n || ring.activeMinLiquidityNative === 0n ||
         economic(ring.activeMinEconLossFloorNative) || economic(ring.activeMinCapitalRequiredFloorNative) || ring.sampleCount < 2)) ||
      (!ready && !completedZero) || (ready && (ring.completedEndSlot === 0n || ring.completedEndSlot > ring.newestSlot ||
        ring.completedActivitySlot !== 0n || ring.completedPriceX64 === 0n || ring.completedPriceX64 > M01_PRICE_MAX_X64 ||
        ring.completedMinDepthTo50BpsNative === 0n || ring.completedMinLiquidityNative === 0n ||
        economic(ring.completedMinEconLossFloorNative) || economic(ring.completedMinCapitalRequiredFloorNative)))) {
    throw new Error("InvalidSourceRing");
  }
  if (pointOnly && !eqBytes(canonicalPointOnlyRing(data), data)) throw new Error("InvalidSourceRing");
  return { ring: pointOnly ? { ...ring, pointOnly: true as const } : ring, dammOnlyBTail: null };
}

function canonicalPointOnlyRing(data: Uint8Array): Uint8Array {
  const o = RING_OFFSETS; const out = new Uint8Array(SOURCE_RING_V1_HEADER_LEN); const view = new DataView(out.buffer);
  const copy = (at: number, len: number, to = at) => out.set(data.subarray(at, at + len), to);
  copy(0, 12); view.setUint32(o.flags, 1, true); copy(o.feedId, 32); copy(o.sourceIndex, 1); view.setUint16(o.ringVersion, 1, true);
  copy(o.adapterType, 1); view.setUint16(o.sampleCount, 1, true); view.setUint16(o.capacity, 300, true); copy(o.minSlotGap, 2);
  copy(o.newestSlot, 8); copy(o.newestSlot, 8, o.oldestSlot); copy(o.lastPriceX64, 16); view.setUint16(o.lastConfidenceBps, 1, true);
  copy(o.lastDepthTo50BpsNative, 32); copy(o.sourceConfigRevision, 16); copy(o.lastObservationHash, 32 * 4); copy(o.bump, 1);
  copy(o.lastFeeRatePpm, 8); copy(o.sourceWeightBps, 4); out[o.feeSource] = FEE_SOURCE_POOL_INLINE; out[o.windowFlags] = 1;
  view.setUint16(o.completedMaxConfidenceBps, 1, true); copy(o.newestSlot, 8, o.completedEndSlot);
  copy(o.lastPriceX64, 16, o.completedPriceX64); copy(o.lastDepthTo50BpsNative, 32, o.completedMinDepthTo50BpsNative);
  return out;
}

export function decodeMimirBrowserSourceRingV1(input: Uint8Array): SourceObservationRingV1Header {
  return decodeMimirBrowserSourceRingV1WithDammTail(input).ring;
}

export function decodeMimirBrowserSourceTemporalModuleV1(
  input: Uint8Array,
  ring: SourceObservationRingV1Header,
): SourceTemporalModuleV1 {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const o = SOURCE_TEMPORAL_MODULE_V1;
  if (data.length !== o.headerLen || !eqBytes(data.subarray(0, 4), utf8("MTP1")) ||
      readU16(data, 4) !== o.abiVersion || readU16(data, 6) !== o.headerLen) throw new Error("InvalidSourceTemporalModule");
  const lastModuleRefreshSlot = readU64(data, o.lastModuleRefreshSlotOffset);
  if (lastModuleRefreshSlot > ring.newestSlot) throw new Error("InvalidSourceTemporalModule");
  return { abiVersion: 1, lastModuleRefreshSlot, dammOnlyBTail: { kind: "damm-onlyb-interval-v1", ...decodeDammCommonTail(data, ring, 1) } };
}

export function decodeMimirBrowserDammReserveTemporalModuleV3(
  data: Uint8Array, ring: SourceObservationRingV1Header,
): DammReserveTemporalModuleV3 {
  const invalid = (): never => { throw new Error("InvalidDammReserveTemporalModuleV3"); };
  if (data.length !== 320 || !eqBytes(data.subarray(0, 4), utf8("MTP3")) ||
      readU16(data, 4) !== 3 || readU16(data, 6) !== 320) invalid();
  const lastModuleRefreshSlot = readU64(data, 8);
  if (lastModuleRefreshSlot > ring.newestSlot) invalid();
  const tail = decodeDammCommonTail(data, ring, 3);
  const db = (offset: number) => readU128(data, offset) | readU128(data, offset + 16) << 128n;
  const dbA = db(256), dbB = db(288);
  if (dbA >= 1n << 192n || dbB >= 1n << 192n ||
      (tail.pendingAnchor === null ? dbB !== 0n : dbB < dbA ||
        tail.pendingAnchor.lpBCumulative < tail.anchor.lpBCumulative ||
        tail.pendingAnchor.protocolBCumulative < tail.anchor.protocolBCumulative ||
        tail.pendingAnchor.permanentK < tail.anchor.permanentK)) invalid();
  return { abiVersion: 3, lastModuleRefreshSlot, dammReserveTail: { ...tail,
    kind: "damm-reserve-interval-v3", anchor: { ...tail.anchor, db: dbA },
    pendingAnchor: tail.pendingAnchor === null ? null : { ...tail.pendingAnchor, db: dbB } } };
}

/** Native Pool offsets include its eight-byte discriminator. Selection follows authenticated roles. */
export function selectMimirDammTemporalVersion(data: Uint8Array): 1 | 3 {
  if (data.length !== 1112 || !eqBytes(data.subarray(0, 8), Uint8Array.of(241, 154, 109, 4, 17, 177, 109, 188)))
    throw new Error("InvalidDammTemporalPool");
  if (data[484] === 1) return 1;
  if (data[484] === 0 && data[696] === 1 && readU16(data, 54) === 0) return 3;
  throw new Error("UnsupportedDammTemporalPool");
}

export function decodeMimirBrowserCpmmQuietTemporalModuleV2(
  input: Uint8Array,
  ring: SourceObservationRingV1Header,
): CpmmQuietTemporalModuleV2 {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const o = CPMM_QUIET_TEMPORAL_MODULE_V2;
  if (data.length !== o.headerLen || !eqBytes(data.subarray(0, 4), utf8(o.magic)) ||
      readU16(data, 4) !== o.abiVersion || readU16(data, 6) !== o.headerLen) {
    throw new Error("InvalidSourceTemporalModule");
  }
  const ringNewestSlot = readU64(data, o.ringNewestSlotOffset);
  const flags = readU16(data, o.flagsOffset);
  if (ringNewestSlot > ring.newestSlot || readU16(data, o.kindOffset) !== o.kind ||
      data.subarray(o.reservedOffset, o.contextHashOffset).some(Boolean) || (flags & ~15) !== 0 ||
      (flags & o.flagA) === 0) {
    throw new Error("InvalidSourceTemporalModule");
  }
  const contextHash = bytes32(data, o.contextHashOffset);
  const lastRefreshUnixTs = readI64(data, o.lastRefreshUnixTsOffset);
  const anchor = (offset: number): CpmmQuietTemporalAnchorV2 => ({
    slot: readU64(data, offset),
    unixTs: readI64(data, offset + 8),
    nativeLastUpdate: readU64(data, offset + 16),
    netX: readU64(data, offset + 24),
    netY: readU64(data, offset + 32),
    lpSupply: readU64(data, offset + 40),
  });
  const anchorA = anchor(o.anchorAOffset);
  const hasB = (flags & o.flagB) !== 0;
  const anchorBBytes = data.subarray(o.anchorBOffset, o.anchorBOffset + o.anchorLen);
  const anchorB = hasB ? anchor(o.anchorBOffset) : null;
  const qLowerX64 = readU128(data, o.qLowerX64Offset);
  const qUpperX64 = readU128(data, o.qUpperX64Offset);
  const hasQ = (flags & o.flagQ) !== 0;
  const invalidated = (flags & o.flagInvalidated) !== 0;
  const validAnchor = (value: CpmmQuietTemporalAnchorV2) => value.slot > 0n && value.slot <= ringNewestSlot &&
    value.unixTs > 0n && value.unixTs <= lastRefreshUnixTs && value.nativeLastUpdate < value.unixTs &&
    value.netX > 0n && value.netY > 0n && value.lpSupply > 0n;
  if (isZeroBytes(contextHash) || lastRefreshUnixTs < 0n || !validAnchor(anchorA) ||
      (!hasB && anchorBBytes.some(Boolean)) || (invalidated && (hasB || hasQ)) ||
      (anchorB !== null && (anchorB.slot <= anchorA.slot || anchorB.unixTs <= anchorA.unixTs ||
        anchorB.nativeLastUpdate !== anchorA.nativeLastUpdate || !validAnchor(anchorB) ||
        anchorB.netX * anchorA.lpSupply < anchorA.netX * anchorB.lpSupply ||
        anchorB.netY * anchorA.lpSupply < anchorA.netY * anchorB.lpSupply ||
        (anchorB.unixTs - anchorA.unixTs >= o.requiredSecs && !hasQ)))) {
    throw new Error("InvalidSourceTemporalModule");
  }
  if (hasQ) {
    if (anchorB === null || qLowerX64 === 0n || qUpperX64 < qLowerX64 ||
        anchorB.unixTs - anchorA.unixTs < o.requiredSecs) {
      throw new Error("InvalidSourceTemporalModule");
    }
  } else if (qLowerX64 !== 0n || qUpperX64 !== 0n) {
    throw new Error("InvalidSourceTemporalModule");
  }
  return {
    kind: "cpmm-quiet-interval-v2",
    abiVersion: 2,
    ringNewestSlot,
    contextHash,
    lastRefreshUnixTs,
    anchorA,
    anchorB,
    qLowerX64,
    qUpperX64,
    invalidated,
  };
}


export const MIMIR_NATIVE_CLOCK_ADDRESS = "SysvarC1ock11111111111111111111111111111111" as Address;
export function readMimirMonoPreviousRevisions(snapshot: Uint8Array, twap: Uint8Array) {
  if (snapshot.length !== 512 || twap.length !== 640) throw new Error("InvalidAccountData");
  return { snapshotRevision: readU64(snapshot, 96), twapRevision: readU64(twap, 256) };
}

export function decodeMimirBrowserSourceRingV1Sentinel(input: Uint8Array, expected: {
  feedId: Uint8Array; sourceIndex: number; adapterType: number; sourceConfigRevision: bigint;
  sourceSetRevision: bigint; sourceConfig: Uint8Array; poolOrMarket: Uint8Array;
  selectedPlanHash: Uint8Array; bump: number; sourceWeightBps: number; routeCorrelationGroup: number;
}): SourceObservationRingHeader {
  if (input.length !== SOURCE_RING_V1_HEADER_LEN) throw new Error("InvalidSourceRing");
  const stamp = readMimirRingStamp(input);
  const canonical = new Uint8Array(SOURCE_RING_V1_HEADER_LEN), canonicalView = view(canonical);
  canonical.set(SOURCE_RING_MAGIC, RING_OFFSETS.magic);
  canonicalView.setUint16(RING_OFFSETS.version, VERSION_V0, true);
  canonicalView.setUint16(RING_OFFSETS.headerLen, SOURCE_RING_V1_HEADER_LEN, true);
  canonical.set(expected.feedId, RING_OFFSETS.feedId);
  canonical[RING_OFFSETS.sourceIndex] = expected.sourceIndex;
  canonical[RING_OFFSETS.status] = SourceStatus.Paused;
  canonicalView.setUint16(RING_OFFSETS.ringVersion, 1, true);
  canonical[RING_OFFSETS.adapterType] = expected.adapterType;
  canonical[RING_OFFSETS.observationKind] = ObservationKind.Spot;
  canonicalView.setBigUint64(RING_OFFSETS.sourceConfigRevision, expected.sourceConfigRevision, true);
  canonicalView.setBigUint64(RING_OFFSETS.sourceSetRevision, expected.sourceSetRevision, true);
  canonical.set(expected.sourceConfig, RING_OFFSETS.sourceConfig);
  canonical.set(expected.poolOrMarket, RING_OFFSETS.poolOrMarket);
  canonical.set(expected.selectedPlanHash, RING_OFFSETS.selectedPlanHash);
  canonical[RING_OFFSETS.bump] = expected.bump;
  canonicalView.setUint16(RING_OFFSETS.sourceWeightBps, expected.sourceWeightBps, true);
  canonicalView.setUint16(RING_OFFSETS.routeCorrelationGroup, expected.routeCorrelationGroup, true);
  if (!eqBytes(withoutMimirRingStamp(input), canonical)) throw new Error("InvalidSourceRing");
  return { ...decodeMimirBrowserSourceRingFields(input), stamp };
}
const SnapshotStatus = {
  Fresh: 0,
  Degraded: 1,
  Stale: 2,
  Halted: 3,
} as const;
const SnapshotSource = {
  Keeper: 0,
  AtomicLite: 1,
  Deep: 2,
  Emergency: 3,
  Composite: 4,
  MixedBounded: 5,
  Sampled: 6,
} as const;
const FeedLifecycleState = {
  Created: 0,
  SourcesPending: 1,
  Warming: 2,
  Active: 3,
  SafetyOnly: 4,
  Deprecated: 5,
  Paused: 6,
  Halted: 7,
} as const;
const RegistryStatus = {
  Active: 0,
  SafetyOnly: 1,
  Paused: 2,
} as const;
const PlanStatus = {
  Active: 0,
  SafetyOnly: 1,
  Deprecated: 2,
  Paused: 3,
} as const;
const TwapStatus = {
  Active: 0,
  Stale: 1,
  Paused: 2,
} as const;

type MonoGenerationAccount = { address: Address; owner: Address; executable: boolean; data: Uint8Array };
const DAMM_PROGRAM_ADDRESS = "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG" as Address;
const DAMM_PROGRAMDATA_ADDRESS = "AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH" as Address;
const CPMM_PROGRAM_ADDRESS = "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C" as Address;
const CPMM_PROGRAMDATA_ADDRESS = "DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU" as Address;
const UPGRADEABLE_LOADER_ADDRESS = "BPFLoaderUpgradeab1e11111111111111111111111" as Address;
const ACCEPTED_DAMM_DEPLOYMENT_SLOT = 457080014n;
const ACCEPTED_CPMM_DEPLOYMENT_SLOT = 452376460n;
const ORCA_PROGRAM_ADDRESS = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc" as Address;
const ORCA_PROGRAMDATA_ADDRESS = "CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD" as Address;
const ACCEPTED_ORCA_DEPLOYMENT_SLOT = 457152296n;
export const ACCEPTED_ORCA_DEPLOYMENT_UNIX = 1792048925n;
export const MIMIR_EXECUTABLE_GENERATION_PINS: Readonly<Record<"damm" | "cpmm" | "orca" | "dlmm", readonly [Address, Address, bigint]>> = {
  damm: [DAMM_PROGRAM_ADDRESS, DAMM_PROGRAMDATA_ADDRESS, ACCEPTED_DAMM_DEPLOYMENT_SLOT],
  cpmm: [CPMM_PROGRAM_ADDRESS, CPMM_PROGRAMDATA_ADDRESS, ACCEPTED_CPMM_DEPLOYMENT_SLOT],
  orca: [ORCA_PROGRAM_ADDRESS, ORCA_PROGRAMDATA_ADDRESS, ACCEPTED_ORCA_DEPLOYMENT_SLOT],
  dlmm: [METEORA_DLMM_PROGRAM, METEORA_DLMM_PROGRAMDATA_ADDRESS, 423977638n],
} as const;
const MIMIR_DEVNET_EXECUTABLE_GENERATION_PINS = {
  damm: [DAMM_PROGRAM_ADDRESS, DAMM_PROGRAMDATA_ADDRESS, 503166267n],
  cpmm: ["DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb" as Address, "3KvTa2fYhMxMZNfHho5oX34yLQLwRauoU2JScBkugvXF" as Address, 498629438n],
  orca: [ORCA_PROGRAM_ADDRESS, ORCA_PROGRAMDATA_ADDRESS, 439560432n],
  dlmm: [METEORA_DLMM_PROGRAM, METEORA_DLMM_PROGRAMDATA_ADDRESS, 466305525n],
} as const;
export type MimirGenerationCluster = "mainnet" | "localnet" | "devnet";
/** Venue executable generations on this cluster: [program, ProgramData, known deployment slot]. Only program and ProgramData are checked. */
export function mimirExecutableGenerationPins(cluster: MimirGenerationCluster = "mainnet"): typeof MIMIR_EXECUTABLE_GENERATION_PINS {
  return cluster === "devnet" ? MIMIR_DEVNET_EXECUTABLE_GENERATION_PINS : MIMIR_EXECUTABLE_GENERATION_PINS;
}
/** Orca WhirlpoolsConfig the program admits on this cluster. */
export function mimirOrcaWhirlpoolsConfigAddress(cluster: MimirGenerationCluster = "mainnet"): Address {
  return (cluster === "devnet" ? "FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR" : canonicalAddress("ORCA_WHIRLPOOLS_CONFIG")) as Address;
}
/** Venue deployment unix times the program checks on this cluster. */
export function mimirVenueDeploymentUnix(cluster: MimirGenerationCluster = "mainnet"): Readonly<{ orca: bigint; dlmm: bigint }> {
  return cluster === "devnet" ? { orca: 1770107735n, dlmm: 1780277719n }
    : { orca: ACCEPTED_ORCA_DEPLOYMENT_UNIX, dlmm: ACCEPTED_METEORA_DLMM_DEPLOYMENT_UNIX };
}
export const ORCA_WHIRLPOOL_ACCOUNT_LEN = 653;
const ORCA_WHIRLPOOL_DISCRIMINATOR = Uint8Array.from([0x3f, 0x95, 0xd1, 0x0c, 0xe1, 0x80, 0x63, 0x09]);
const ORCA_WHIRLPOOL_MARKER_OFFSET = 261;

function verifyExecutableGeneration(program: MonoGenerationAccount, programData: MonoGenerationAccount,
  [expectedProgram, expectedProgramData]: readonly [Address, Address, bigint]): boolean {
  if (program.address !== expectedProgram || programData.address !== expectedProgramData ||
      program.owner !== UPGRADEABLE_LOADER_ADDRESS || !program.executable || program.data.length !== 36 ||
      programData.owner !== UPGRADEABLE_LOADER_ADDRESS || programData.executable || programData.data.length < 45 ||
      readU32(program.data, 0) !== 2 || !eqBytes(program.data.subarray(4, 36), addressBytes(programData.address)) ||
      readU32(programData.data, 0) !== 3 ||
      programData.data[12]! > 1 || (programData.data[12] === 0 && programData.data.subarray(13, 45).some(Boolean)) ||
      (programData.data[12] === 1 && !programData.data.subarray(13, 45).some(Boolean))) return false;
  return true;
}

export function verifyDammExecutableGeneration(program: MonoGenerationAccount, programData: MonoGenerationAccount,
  cluster: MimirGenerationCluster = "mainnet"): boolean {
  return verifyExecutableGeneration(program, programData, mimirExecutableGenerationPins(cluster).damm);
}

export function verifyOrcaExecutableGeneration(program: MonoGenerationAccount, programData: MonoGenerationAccount,
  cluster: MimirGenerationCluster = "mainnet"): boolean {
  return verifyExecutableGeneration(program, programData, mimirExecutableGenerationPins(cluster).orca);
}

export function verifyDlmmExecutableGeneration(program: MonoGenerationAccount, programData: MonoGenerationAccount,
  cluster: MimirGenerationCluster = "mainnet"): boolean {
  return verifyExecutableGeneration(program, programData, mimirExecutableGenerationPins(cluster).dlmm);
}

/** Kind-7 marker-quiet interval: start = max(M + 1, D + 1); ready once now - start >= 120. */
export function mimirOrcaMarkerQuietInterval(whirlpoolData: Uint8Array, officialConfig: Uint8Array, nowUnixTs: bigint,
  deploymentUnixTs: bigint = ACCEPTED_ORCA_DEPLOYMENT_UNIX): { markerUnixTs: bigint; startUnixTs: bigint; readyAtUnixTs: bigint; ready: boolean } {
  if (whirlpoolData.length !== ORCA_WHIRLPOOL_ACCOUNT_LEN || !eqBytes(whirlpoolData.subarray(0, 8), ORCA_WHIRLPOOL_DISCRIMINATOR) ||
      !eqBytes(whirlpoolData.subarray(8, 40), officialConfig)) throw new Error("InvalidAccountData");
  const markerUnixTs = readU64(whirlpoolData, ORCA_WHIRLPOOL_MARKER_OFFSET);
  if (markerUnixTs === 0n) throw new Error("InvalidSourceRing");
  const startUnixTs = markerUnixTs + 1n > deploymentUnixTs + 1n ? markerUnixTs + 1n : deploymentUnixTs + 1n;
  return { markerUnixTs, startUnixTs, readyAtUnixTs: startUnixTs + 120n,
    ready: markerUnixTs < nowUnixTs && nowUnixTs - startUnixTs >= 120n };
}

export function verifyCpmmExecutableGeneration(program: MonoGenerationAccount, programData: MonoGenerationAccount,
  cluster: MimirGenerationCluster = "mainnet"): boolean {
  return verifyExecutableGeneration(program, programData, mimirExecutableGenerationPins(cluster).cpmm);
}

/** Same source-context preimage as the normal CPMM quiet writer. */
export function computeMimirCpmmQuietContextHash(input: { sourceConfig: Address; source: SourceConfigHeader;
  feed: FeedConfigHeader; planHash: Uint8Array; ammConfig: Address; oracle: Address;
  sourceProgram: Address; sourceProgramData: Address; token0IsBase: boolean; cluster?: MimirGenerationCluster }): Uint8Array {
  const { source, feed } = input;
  const u64 = (value: bigint) => { const data = new Uint8Array(8); view(data).setBigUint64(0, value, true); return data; };
  const version = new Uint8Array(2); view(version).setUint16(0, source.adapterVersion, true);
  return sha256(concatBytes(utf8("MIMIR_RAYDIUM_CPMM_QUIET_INTERVAL_V2"), source.feedId,
    Uint8Array.of(source.sourceIndex), addressBytes(input.sourceConfig), u64(source.sourceConfigRevision), u64(source.sourceSetRevision),
    feed.sourceSetHash, u64(feed.feedConfigRevision), u64(feed.registryEpoch), input.planHash,
    source.programId, source.poolOrMarket, source.baseVault, source.quoteVault, source.poolOrMarket,
    addressBytes(input.ammConfig), addressBytes(input.oracle), addressBytes(input.sourceProgram), addressBytes(input.sourceProgramData),
    source.baseMint, source.quoteMint, source.tokenProgram,
    Uint8Array.of(feed.baseDecimals, feed.quoteDecimals, source.direction), version, Uint8Array.of(Number(input.token0IsBase))));
}

function monoFingerprint(observation: Address, oldTimestamp: bigint, newTimestamp: bigint,
  oldCumulative: bigint, newCumulative: bigint): Uint8Array {
  const timesAndCumulatives = new Uint8Array(48);
  const data = new DataView(timesAndCumulatives.buffer);
  data.setBigUint64(0, oldTimestamp, true); data.setBigUint64(8, newTimestamp, true);
  data.setBigUint64(16, oldCumulative & U64_MAX, true); data.setBigUint64(24, oldCumulative >> 64n, true);
  data.setBigUint64(32, newCumulative & U64_MAX, true); data.setBigUint64(40, newCumulative >> 64n, true);
  return sha256(concatBytes(utf8("MIMIR_RAYDIUM_CPMM_NATIVE_RING_V1"), addressBytes(observation), timesAndCumulatives));
}

export interface RaydiumCpmmNativeBoundedSample {
  readonly startTimestamp: bigint; readonly endTimestamp: bigint;
  readonly startCumulativeX32: bigint; readonly endCumulativeX32: bigint;
  readonly lowerX64: bigint; readonly upperX64: bigint; readonly centerX64: bigint;
  readonly effectiveStartTimestamp?: bigint; readonly finalLowerX64?: bigint; readonly finalUpperX64?: bigint;
}

export function computeRaydiumCpmmNativeBoundedFingerprint(observationState: Uint8Array, sample: RaydiumCpmmNativeBoundedSample): Uint8Array {
  if (observationState.length !== 32) throw new Error("InvalidRaydiumCpmmObservationState");
  const values = new Uint8Array(80), data = new DataView(values.buffer);
  data.setBigUint64(0, sample.startTimestamp, true); data.setBigUint64(8, sample.endTimestamp, true);
  [sample.startCumulativeX32, sample.endCumulativeX32, sample.lowerX64, sample.upperX64].forEach((value, index) => {
    if (value < 0n || value >= 1n << 128n) throw new Error("InvalidTwapState");
    data.setBigUint64(16 + index * 16, value & U64_MAX, true); data.setBigUint64(24 + index * 16, value >> 64n, true);
  });
  return sha256(concatBytes(utf8("MIMIR_RAYDIUM_CPMM_NATIVE_RING_V3"), observationState, values));
}

export function computeRaydiumCpmmNativeTwapObservationFingerprint(params: {
  observationState: Uint8Array;
  oldTimestamp: bigint;
  newTimestamp: bigint;
  oldCumulativeToken0PriceX32: bigint;
  newCumulativeToken0PriceX32: bigint;
  oldCumulativeToken1PriceX32: bigint;
  newCumulativeToken1PriceX32: bigint;
  useToken0Price: boolean;
}): Uint8Array {
  if (params.observationState.length !== 32) throw new Error("InvalidRaydiumCpmmObservationState");
  return monoFingerprint(bytesAddress(params.observationState), params.oldTimestamp, params.newTimestamp,
    params.useToken0Price ? params.oldCumulativeToken0PriceX32 : params.oldCumulativeToken1PriceX32,
    params.useToken0Price ? params.newCumulativeToken0PriceX32 : params.newCumulativeToken1PriceX32);
}

export function dlmmMonoFingerprint(oracle: Address, sourceConfig: Address, pool: Address, planHash: Uint8Array,
  oldTimestamp: bigint, newTimestamp: bigint, oldCumulative: bigint, newCumulative: bigint,
  token2022Binding?: { mintAddress: Uint8Array; selectedBase: boolean; selectedMultiplierQ64: bigint },
  lagEnvelope?: Pick<MimirNativeLagEnvelope, "spotX64" | "confidenceBps"> | null): Uint8Array {
  const values = new Uint8Array(48); const data = new DataView(values.buffer);
  data.setBigUint64(0, oldTimestamp, true); data.setBigUint64(8, newTimestamp, true);
  data.setBigUint64(16, oldCumulative & U64_MAX, true); data.setBigUint64(24, (oldCumulative >> 64n) & U64_MAX, true);
  data.setBigUint64(32, newCumulative & U64_MAX, true); data.setBigUint64(40, (newCumulative >> 64n) & U64_MAX, true);
  const fingerprint = mimirNativeLagEnvelopeFingerprint(sha256(concatBytes(utf8("MIMIR_METEORA_DLMM_NATIVE_RING_V1"),
    addressBytes(oracle), addressBytes(sourceConfig), addressBytes(pool), planHash, values)), lagEnvelope);
  if (!token2022Binding) return fingerprint;
  const multiplier = new Uint8Array(16), multiplierView = new DataView(multiplier.buffer);
  multiplierView.setBigUint64(0, token2022Binding.selectedMultiplierQ64 & U64_MAX, true);
  multiplierView.setBigUint64(8, token2022Binding.selectedMultiplierQ64 >> 64n, true);
  return sha256(concatBytes(utf8("MIMIR_METEORA_DLMM_NATIVE_TOKEN2022_ECONOMIC_V1"), fingerprint,
    token2022Binding.mintAddress, Uint8Array.of(Number(token2022Binding.selectedBase)), multiplier));
}

const FEED_SNAPSHOT_MIN_HEADER_LEN = 512;
const OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  feedId: 16,
  feedConfig: 48,
  registryEpoch: 80,
  feedConfigRevision: 88,
  snapshotRevision: 96,
  status: 104,
  routeabilityStatus: 105,
  riskTier: 106,
  snapshotSource: 107,
  freshnessProfile: 108,
  planProfile: 109,
  snapshotSlot: 116,
  validUntilSlot: 124,
  snapshotUnixTs: 132,
  spotSlot: 140,
  oldestSourceObservedSlot: 148,
  oldestSourceActivitySlot: 156,
  twapShortEndSlot: 164,
  twapMediumEndSlot: 172,
  twapLongEndSlot: 180,
  priceMantissa: 188,
  priceExponent: 196,
  priceX64: 200,
  priceLowerX64: 216,
  priceUpperX64: 232,
  confidenceBps: 248,
  dispersionBps: 250,
  sourceCount: 252,
  venueCount: 253,
  correlationGroupCount: 254,
  coverageRatioBps: 255,
  quoteStatus: 257,
  sourcingPlanId: 258,
  sourcingPlanVersion: 260,
  sourcingPlanHash: 262,
  sourceMask: 294,
  bandCapitalNotional: 302,
  attackerSetFeeLossFloorMirror: 318,
  anchorProvider: 334,
  anchorStatus: 335,
  anchorConfidenceBps: 352,
  anchorDivergenceBps: 354,
  anchorPolicyHash: 356,
  nativeExceptionHash: 388,
  capModelVersion: 420,
  capModelFlags: 422,
  econLossBandBps: 424,
  attackerSetWeightBps: 426,
  attackerSetSourceCount: 428,
  effectiveSourceCount: 429,
  capTierSafetyFactor: 430,
  attackerSourceMask: 432,
  attackerSetEconLossFloorNative: 440,
  attackerSetCapitalRequiredFloorNative: 456,
  capModelHash: 472,
} as const;
const FEED_SNAPSHOT_MAGIC = utf8("MIMIRSNP");
const RouteabilityStatus = {
  Unrated: 0,
  TierC: 1,
  TierB: 2,
  TierA: 3,
  SafetyOnly: 4,
  Disabled: 5,
} as const;
const RiskTier = {
  Unrated: 0,
  TierC: 1,
  TierB: 2,
  TierA: 3,
} as const;
const FreshnessProfile = {
  Hot0: 0,
  Hot1: 1,
  Fast2: 2,
  Safe5: 3,
  PreviousSlotOnly: 4,
  AnchorChecked: 5,
} as const;
const PlanProfile = {
  Snapshot: 0,
  AtomicLite3: 1,
  AtomicLite4: 2,
  AtomicLite5: 3,
  Deep: 4,
} as const;
const QuoteStatus = {
  Ok: 0,
  Depeg: 1,
  Unknown: 2,
} as const;
const AnchorProvider = {
  None: 0,
  NativeOnlyException: 4,
} as const;
const AnchorStatus = {
  Ok: 0,
  Missing: 1,
  Stale: 2,
  WideConfidence: 3,
  Diverged: 4,
  InvalidVerification: 5,
} as const;
const COMPOSITE_SNAPSHOT_HEADER_LEN = 720;
const COMPOSITE_SNAPSHOT_COMPONENT_LEN = 80;
const MIN_COMPOSITE_COMPONENTS = 1;
const MAX_COMPOSITE_COMPONENTS = 5;
const COMPOSITE_SNAPSHOT_MAGIC = utf8("MIMIRCSP");
const COMPOSITE_SNAPSHOT_OFFSETS = {
  magic: 0, version: 8, headerLen: 10, flags: 12, feedId: 16, compositeConfig: 48,
  registryEpoch: 80, configRevision: 88, snapshotRevision: 96, status: 104,
  routeabilityStatus: 105, riskTier: 106, snapshotSource: 107, freshnessProfile: 108,
  componentCount: 109, quoteStatus: 110, snapshotSlot: 112, validUntilSlot: 120,
  snapshotUnixTs: 128, oldestComponentSnapshotSlot: 136, oldestComponentActivitySlot: 144,
  priceMantissa: 152, priceExponent: 160, confidenceBps: 164, dispersionBps: 166,
  priceX64: 168, priceLowerX64: 184, priceUpperX64: 200, componentMinCapitalFloor: 216,
  componentMinFeeLossFloor: 232, componentSetHash: 248, componentSnapshotHash: 280,
  anchorProvider: 312, anchorStatus: 313, components: 320,
} as const;
const COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS = {
  feedId: 0, snapshotRevision: 32, snapshotSlot: 40, priceX64: 48, contributionX64: 64,
} as const;
const MAX_TWAP_AGGREGATION_SOURCES = 5;
const CAP_MODEL_VERSION_V2 = 2;
const CAP_MODEL_ATTACKER_WEIGHT_THRESHOLD_BPS = 5_000;
const CAP_MODEL_MAX_SOURCES = 5;
const CAP_MODEL_HASH_V2 = utf8("MIMIR_CAP_MODEL_V2_FINAL_2026062");
const FEED_TWAP_HEADER_LEN = 640;
const TWAP_OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  flags: 12,
  feedId: 16,
  twapVersion: 48,
  status: 50,
  freshnessProfile: 51,
  shortEndSlot: 56,
  mediumEndSlot: 64,
  longEndSlot: 72,
  twapShortX64: 80,
  twapMediumX64: 96,
  twapLongX64: 112,
  coverageRatioBps: 128,
  sourceActivitySlotMin: 136,
  sourceMask: 144,
  unknownActivitySourceMask: 152,
  sanityMinDepthTo50BpsWindow: 160,
  sanityFeeLossFloorWindow: 176,
  selectedPlanHash: 192,
  correlationMaskHash: 224,
  revision: 256,
  sourceSetRevision: 264,
  bump: 272,
  maxConfidenceBps: 273,
  maxDispersionBps: 275,
  attackerSetEconLossFloorWindowNative: 320,
  attackerSetCapitalRequiredFloorWindowNative: 336,
  attackerSetWeightBps: 352,
  attackerSetSourceCount: 354,
  effectiveSourceCount: 355,
  capModelFlags: 356,
  econLossBandBps: 358,
  attackerSourceMask: 360,
  sourceTableCount: 368,
  sourceTable: 384,
} as const;
const FEED_TWAP_MAGIC = utf8("MIMIRTWP");
export function decodeLifecycleFeedTwapSentinel(input: Uint8Array, expected: {
  feedId: Uint8Array; twapVersion: number; selectedPlanHash: Uint8Array; bump: number;
}): LifecycleFeedTwapSentinel {
  if (input.byteLength !== FEED_TWAP_HEADER_LEN) throw new Error("InvalidLifecycleTwapSentinel");
  const canonical = new Uint8Array(FEED_TWAP_HEADER_LEN), canonicalView = view(canonical);
  canonical.set(FEED_TWAP_MAGIC, TWAP_OFFSETS.magic); canonicalView.setUint16(TWAP_OFFSETS.version, VERSION_V0, true);
  canonicalView.setUint16(TWAP_OFFSETS.headerLen, FEED_TWAP_HEADER_LEN, true); canonical.set(expected.feedId, TWAP_OFFSETS.feedId);
  canonicalView.setUint16(TWAP_OFFSETS.twapVersion, expected.twapVersion, true); canonical[TWAP_OFFSETS.status] = TwapStatus.Paused;
  canonical.set(expected.selectedPlanHash, TWAP_OFFSETS.selectedPlanHash); canonicalView.setBigUint64(TWAP_OFFSETS.sourceSetRevision, 1n, true);
  canonical[TWAP_OFFSETS.bump] = expected.bump;
  if (!eqBytes(input, canonical)) throw new Error("InvalidLifecycleTwapSentinel");
  return { feedId: bytes32(input, TWAP_OFFSETS.feedId), twapVersion: readU16(input, TWAP_OFFSETS.twapVersion), status: input[TWAP_OFFSETS.status]!,
    selectedPlanHash: bytes32(input, TWAP_OFFSETS.selectedPlanHash), revision: 0n, sourceSetRevision: 1n, bump: input[TWAP_OFFSETS.bump]! };
}

export function decodeLifecycleFeedSnapshotSentinel(input: Uint8Array, expected: {
  feedId: Uint8Array; feedConfig: Uint8Array; registryEpoch: bigint; riskTier: number; planProfile: number; priceExponent: number;
  sourcingPlanId: number; sourcingPlanVersion: number; sourcingPlanHash: Uint8Array; anchorPolicyHash: Uint8Array; nativeExceptionHash: Uint8Array;
}): LifecycleFeedSnapshotSentinel {
  if (input.byteLength !== FEED_SNAPSHOT_MIN_HEADER_LEN) throw new Error("InvalidLifecycleSnapshotSentinel");
  const canonical = new Uint8Array(FEED_SNAPSHOT_MIN_HEADER_LEN), canonicalView = view(canonical);
  canonical.set(FEED_SNAPSHOT_MAGIC, OFFSETS.magic); canonicalView.setUint16(OFFSETS.version, VERSION_V0, true);
  canonicalView.setUint16(OFFSETS.headerLen, FEED_SNAPSHOT_MIN_HEADER_LEN, true); canonical.set(expected.feedId, OFFSETS.feedId);
  canonical.set(expected.feedConfig, OFFSETS.feedConfig); canonicalView.setBigUint64(OFFSETS.registryEpoch, expected.registryEpoch, true);
  canonicalView.setBigUint64(OFFSETS.feedConfigRevision, 1n, true); canonical[OFFSETS.status] = SnapshotStatus.Halted;
  canonical[OFFSETS.routeabilityStatus] = RouteabilityStatus.Disabled; canonical[OFFSETS.riskTier] = expected.riskTier;
  canonical[OFFSETS.snapshotSource] = SnapshotSource.Keeper; canonical[OFFSETS.freshnessProfile] = FreshnessProfile.Hot0;
  canonical[OFFSETS.planProfile] = expected.planProfile; canonicalView.setInt32(OFFSETS.priceExponent, expected.priceExponent, true);
  canonicalView.setUint16(OFFSETS.sourcingPlanId, expected.sourcingPlanId, true); canonicalView.setUint16(OFFSETS.sourcingPlanVersion, expected.sourcingPlanVersion, true);
  canonical.set(expected.sourcingPlanHash, OFFSETS.sourcingPlanHash); canonical.set(expected.anchorPolicyHash, OFFSETS.anchorPolicyHash);
  canonical.set(expected.nativeExceptionHash, OFFSETS.nativeExceptionHash);
  if (!eqBytes(input, canonical)) throw new Error("InvalidLifecycleSnapshotSentinel");
  return { feedId: bytes32(input, OFFSETS.feedId), feedConfig: bytes32(input, OFFSETS.feedConfig), registryEpoch: readU64(input, OFFSETS.registryEpoch),
    feedConfigRevision: 1n, snapshotRevision: 0n, status: input[OFFSETS.status]!, routeabilityStatus: input[OFFSETS.routeabilityStatus]!,
    riskTier: input[OFFSETS.riskTier]!, snapshotSource: input[OFFSETS.snapshotSource]!, freshnessProfile: input[OFFSETS.freshnessProfile]!,
    planProfile: input[OFFSETS.planProfile]!, priceExponent: view(input).getInt32(OFFSETS.priceExponent, true),
    sourcingPlanId: readU16(input, OFFSETS.sourcingPlanId), sourcingPlanVersion: readU16(input, OFFSETS.sourcingPlanVersion),
    sourcingPlanHash: bytes32(input, OFFSETS.sourcingPlanHash), anchorPolicyHash: bytes32(input, OFFSETS.anchorPolicyHash),
    nativeExceptionHash: bytes32(input, OFFSETS.nativeExceptionHash) };
}
const CAP_MODEL_SOURCE_ENTRY_LEN = 48;
const SOURCE_CAP_ENTRY_OFFSETS = {
  sourceIndex: 0,
  flags: 1,
  weightBps: 2,
  routeCorrelationGroup: 4,
  reserved: 6,
  econLossFloorNative: 8,
  capitalRequiredFloorNative: 24,
  sourceSetRevision: 40,
} as const;
const CONFIG_OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  flags: 12,
  feedId: 16,
  baseMint: 48,
  quoteMint: 80,
  priceExponent: 112,
  riskTier: 116,
  lifecycleState: 117,
  baseDecimals: 118,
  quoteDecimals: 119,
  minSourceCount: 120,
  minVenueCount: 121,
  minCorrelationGroupCount: 122,
  minCoverageRatioBps: 124,
  maxConfidenceBps: 126,
  maxDispersionBps: 128,
  maxSnapshotAgeSlots: 130,
  maxSourceActivityAgeSlots: 132,
  sourceSetHash: 136,
  defaultSourcingPlan: 168,
  fallbackSourcingPlan: 200,
  anchorPolicyHash: 232,
  nativeExceptionHash: 264,
  feedConfigRevision: 296,
  registryEpoch: 304,
  bump: 312,
} as const;
const FEED_CONFIG_HEADER_LEN = 325;
const VERSION_V1 = 1;
const FEED_CONFIG_V1_HEADER_LEN = 357;
const FEED_CONFIG_MAGIC = utf8("MIMIRCFG");
const FEED_CONFIG_IDENTITY_ASSET_OFFSET = 325;
const ORACLE_REGISTRY_HEADER_LEN = 128;
const REGISTRY_OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  flags: 12,
  authority: 16,
  emergencyAuthority: 48,
  supportedAdapterMask: 80,
  minFeedConfigVersion: 88,
  registryEpoch: 96,
  status: 104,
  bump: 105,
  adapterVersionMasks: 106,
} as const;
const ORACLE_REGISTRY_MAGIC = utf8("MIMIRREG");
const REGISTRY_ADAPTER_VERSION_MASK_COUNT = 8;
const REGISTRY_ADAPTER_VERSION_MASK_BYTES = 2;
const SOURCING_PLAN_HEADER_LEN = 320;
const PLAN_OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  flags: 12,
  feedId: 16,
  planId: 48,
  planVersion: 50,
  profile: 52,
  status: 53,
  riskTier: 54,
  minSources: 55,
  minVenues: 56,
  minCorrelationGroups: 57,
  maxDispersionBps: 58,
  maxSourceActivityAgeSlots: 60,
  priceExponent: 64,
  baseMint: 68,
  quoteMint: 100,
  sourceSetHash: 132,
  accountsHash: 164,
  planHash: 196,
  twapState: 228,
  anchorPolicyHash: 260,
  adapterMask: 292,
  bump: 300,
  hashSchemeVersion: 301,
  ringVersion: 302,
  accountsBindingVersion: 304,
  reservedTail: 305,
} as const;
const SOURCING_PLAN_MAGIC = utf8("MIMIRPLN");
const SOURCE_CONFIG_HEADER_LEN = 384;
const SOURCE_OFFSETS = {
  magic: 0,
  version: 8,
  headerLen: 10,
  flags: 12,
  feedId: 16,
  sourceIndex: 48,
  adapterType: 49,
  status: 50,
  direction: 51,
  adapterVersion: 52,
  venueGroup: 54,
  operatorGroup: 56,
  liquidityOwnerGroup: 58,
  routeCorrelationGroup: 60,
  quoteAssetGroup: 62,
  bridgeOrWrapperGroup: 64,
  oracleSourceClass: 66,
  upgradeAuthorityGroup: 68,
  maxSourceWeightBps: 70,
  minLiquidityNative: 72,
  minDepthTo50BpsNative: 88,
  programId: 104,
  poolOrMarket: 136,
  baseVault: 168,
  quoteVault: 200,
  baseMint: 232,
  quoteMint: 264,
  tokenProgram: 296,
  vaultAuthority: 328,
  sourceConfigRevision: 360,
  sourceSetRevision: 368,
  bump: 376,
} as const;
const SOURCE_CONFIG_MAGIC = utf8("MIMIRSRC");
const RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET = 296;
const RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR = Uint8Array.from([
  247, 237, 227, 245, 215, 195, 222, 70,
]);
const RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG = 8;
const RAYDIUM_CPMM_POOL_OFFSET_STATUS = 329;
const RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK = 4;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT = 72;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT = 104;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT = 168;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT = 200;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM = 232;
const RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM = 264;
const SPL_TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address;
const RAYDIUM_CPMM_POOL_OFFSET_MINT_0_DECIMALS = 331;
const RAYDIUM_CPMM_POOL_OFFSET_MINT_1_DECIMALS = 332;
const RAYDIUM_CPMM_OBSERVATION_STATE_LEN = 4075;
const RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR = Uint8Array.from([
  122, 174, 197, 53, 129, 9, 165, 132,
]);
const RAYDIUM_CPMM_OBSERVATION_STATE_INITIALIZED_OFFSET = 8;
const RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET = 11;
const RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET = 9;
const RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT = 100;
const RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET = 43;
const RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN = 40;
const RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET =
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET +
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT *
    RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN;
const RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET = 0;
const RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET = 8;
const RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET = 24;
const U128_MAX = (1n << 128n) - 1n;
const RAYDIUM_CPMM_POOL_MIN_TOKEN_READABLE_LEN = RAYDIUM_CPMM_POOL_OFFSET_MINT_1_DECIMALS + 1;
const readI64 = (data: Uint8Array, offset: number) => view(data).getBigInt64(offset, true);

export class RaydiumCpmmNativeTwapWindowWarmingError extends Error {
  readonly observedSpanSecs: bigint;
  readonly requiredWindowSecs: bigint;

  constructor(observedSpanSecs: bigint, requiredWindowSecs: bigint) {
    super("InvalidTwapState");
    this.name = "RaydiumCpmmNativeTwapWindowWarmingError";
    this.observedSpanSecs = observedSpanSecs;
    this.requiredWindowSecs = requiredWindowSecs;
  }
}

export function decodeFeedSnapshotHeader(input: Uint8Array): FeedSnapshotHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < FEED_SNAPSHOT_MIN_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (readU16(data, OFFSETS.headerLen) !== FEED_SNAPSHOT_MIN_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }
  if (!eqBytes(data.subarray(OFFSETS.magic, OFFSETS.magic + 8), FEED_SNAPSHOT_MAGIC)) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }

  const header = {
    feedId: bytes32(data, OFFSETS.feedId),
    feedConfig: bytes32(data, OFFSETS.feedConfig),
    registryEpoch: readU64(data, OFFSETS.registryEpoch),
    feedConfigRevision: readU64(data, OFFSETS.feedConfigRevision),
    snapshotRevision: readU64(data, OFFSETS.snapshotRevision),
    status: data[OFFSETS.status],
    routeabilityStatus: data[OFFSETS.routeabilityStatus],
    riskTier: data[OFFSETS.riskTier],
    snapshotSource: data[OFFSETS.snapshotSource],
    freshnessProfile: data[OFFSETS.freshnessProfile],
    planProfile: data[OFFSETS.planProfile],
    snapshotSlot: readU64(data, OFFSETS.snapshotSlot),
    validUntilSlot: readU64(data, OFFSETS.validUntilSlot),
    snapshotUnixTs: readI64(data, OFFSETS.snapshotUnixTs),
    spotSlot: readU64(data, OFFSETS.spotSlot),
    oldestSourceObservedSlot: readU64(data, OFFSETS.oldestSourceObservedSlot),
    oldestSourceActivitySlot: readU64(data, OFFSETS.oldestSourceActivitySlot),
    twapShortEndSlot: readU64(data, OFFSETS.twapShortEndSlot),
    twapMediumEndSlot: readU64(data, OFFSETS.twapMediumEndSlot),
    twapLongEndSlot: readU64(data, OFFSETS.twapLongEndSlot),
    priceMantissa: readU64(data, OFFSETS.priceMantissa),
    priceExponent: view(data).getInt32(OFFSETS.priceExponent, true),
    priceX64: readU128(data, OFFSETS.priceX64),
    priceLowerX64: readU128(data, OFFSETS.priceLowerX64),
    priceUpperX64: readU128(data, OFFSETS.priceUpperX64),
    confidenceBps: readU16(data, OFFSETS.confidenceBps),
    dispersionBps: readU16(data, OFFSETS.dispersionBps),
    sourceCount: data[OFFSETS.sourceCount],
    venueCount: data[OFFSETS.venueCount],
    correlationGroupCount: data[OFFSETS.correlationGroupCount],
    coverageRatioBps: readU16(data, OFFSETS.coverageRatioBps),
    quoteStatus: data[OFFSETS.quoteStatus],
    sourcingPlanId: readU16(data, OFFSETS.sourcingPlanId),
    sourcingPlanVersion: readU16(data, OFFSETS.sourcingPlanVersion),
    sourcingPlanHash: bytes32(data, OFFSETS.sourcingPlanHash),
    sourceMask: readU64(data, OFFSETS.sourceMask),
    bandCapitalNotional: readU128(data, OFFSETS.bandCapitalNotional),
    attackerSetFeeLossFloorMirror: readU128(data, OFFSETS.attackerSetFeeLossFloorMirror),
    anchorProvider: data[OFFSETS.anchorProvider],
    anchorStatus: data[OFFSETS.anchorStatus],
    anchorPolicyHash: bytes32(data, OFFSETS.anchorPolicyHash),
    nativeExceptionHash: bytes32(data, OFFSETS.nativeExceptionHash),
    capModelVersion: readU16(data, OFFSETS.capModelVersion),
    capModelFlags: readU16(data, OFFSETS.capModelFlags),
    econLossBandBps: readU16(data, OFFSETS.econLossBandBps),
    attackerSetWeightBps: readU16(data, OFFSETS.attackerSetWeightBps),
    attackerSetSourceCount: data[OFFSETS.attackerSetSourceCount],
    effectiveSourceCount: data[OFFSETS.effectiveSourceCount],
    capTierSafetyFactor: readU16(data, OFFSETS.capTierSafetyFactor),
    attackerSourceMask: readU64(data, OFFSETS.attackerSourceMask),
    attackerSetEconLossFloorNative: readU128(
      data,
      OFFSETS.attackerSetEconLossFloorNative,
    ),
    attackerSetCapitalRequiredFloorNative: readU128(
      data,
      OFFSETS.attackerSetCapitalRequiredFloorNative,
    ),
    capModelHash: bytes32(data, OFFSETS.capModelHash),
  };

  validateEnum(header.status, SnapshotStatus.Halted);
  validateEnum(header.routeabilityStatus, RouteabilityStatus.Disabled);
  validateEnum(header.riskTier, RiskTier.TierA);
  if (![SnapshotSource.MixedBounded, SnapshotSource.Sampled, MIMIR_CURRENT_POINT_SNAPSHOT_SOURCE_KIND].includes(header.snapshotSource)) {
    validateEnum(header.snapshotSource, SnapshotSource.Emergency);
  }
  validateEnum(header.freshnessProfile, FreshnessProfile.AnchorChecked);
  validateEnum(header.planProfile, PlanProfile.Deep);
  validateEnum(header.quoteStatus, QuoteStatus.Unknown);
  validateEnum(header.anchorProvider, AnchorProvider.NativeOnlyException);
  validateEnum(header.anchorStatus, AnchorStatus.InvalidVerification);
  if (header.status === SnapshotStatus.Fresh && [1, 5, 6].includes(header.snapshotSource)) {
    validateFrontier(data.subarray(0, FEED_SNAPSHOT_MIN_HEADER_LEN));
  }
  if (header.status === SnapshotStatus.Degraded) {
    if (data.length !== FEED_SNAPSHOT_MIN_HEADER_LEN) throw new Error("InvalidDegradedSnapshot");
    const { liveness, lastUsable } = validateDegradedSnapshot(data);
    return { ...withoutBlockClocks(header), liveness, lastUsable };
  }
  if (header.snapshotSource === SnapshotSource.Sampled) {
    decodeMimirSampledSource6Snapshot(data);
    if (data.length !== FEED_SNAPSHOT_MIN_HEADER_LEN || header.spotSlot !== header.oldestSourceObservedSlot ||
        header.oldestSourceObservedSlot === 0n || data.subarray(12, 16).some(Boolean) || data.subarray(110, 116).some(Boolean) || header.coverageRatioBps !== 10000 ||
        header.quoteStatus !== 0 || header.anchorProvider !== 0 || header.anchorStatus !== 1 || data.subarray(336, 356).some(Boolean) ||
        header.freshnessProfile > FreshnessProfile.AnchorChecked || header.planProfile > PlanProfile.Deep ||
        header.sourceCount === 0 || header.sourceCount > MAX_TWAP_AGGREGATION_SOURCES || header.venueCount === 0 ||
        header.venueCount > header.sourceCount || header.correlationGroupCount === 0 || header.correlationGroupCount > header.sourceCount ||
        header.effectiveSourceCount > header.sourceCount || header.confidenceBps === 0 || header.confidenceBps > 10_000 ||
        header.dispersionBps > 10_000 || header.priceX64 > M01_PRICE_MAX_X64 || header.sourceMask >> 5n !== 0n ||
        header.validUntilSlot < header.snapshotSlot || header.snapshotRevision === 0n) {
      throw new Error("InvalidSampledSource6Snapshot");
    }
    return withoutBlockClocks(header);
  }
  if (header.snapshotSource === MIMIR_CURRENT_POINT_SNAPSHOT_SOURCE_KIND) {
    decodeMimirCurrentPointSource7Snapshot(data);
    if (data.length !== FEED_SNAPSHOT_MIN_HEADER_LEN || header.spotSlot !== header.oldestSourceObservedSlot ||
        header.oldestSourceObservedSlot === 0n || data.subarray(12, 16).some(Boolean) || data.subarray(110, 116).some(Boolean) ||
        header.quoteStatus !== 0 || header.anchorProvider !== 0 || header.anchorStatus !== 1 || data.subarray(336, 356).some(Boolean) ||
        header.twapShortEndSlot !== 0n || header.twapMediumEndSlot !== 0n || header.twapLongEndSlot !== 0n ||
        header.sourceCount === 0 || header.sourceCount > MAX_TWAP_AGGREGATION_SOURCES || header.coverageRatioBps === 0 ||
        header.coverageRatioBps > 10_000 || header.effectiveSourceCount > header.sourceCount || header.dispersionBps > 10_000 ||
        header.priceX64 > M01_PRICE_MAX_X64 || header.sourceMask >> 5n !== 0n || bitCountU64(header.sourceMask) !== header.sourceCount ||
        header.validUntilSlot < header.snapshotSlot || header.snapshotRevision === 0n) {
      throw new Error("InvalidCurrentPointSource7Snapshot");
    }
    return withoutBlockClocks(header);
  }
  if (header.snapshotSource === SnapshotSource.MixedBounded && (data.length !== FEED_SNAPSHOT_MIN_HEADER_LEN || header.status !== SnapshotStatus.Fresh ||
      header.coverageRatioBps !== 10000 ||
      header.priceLowerX64 <= 0n || header.priceLowerX64 > header.priceX64 || header.priceX64 > header.priceUpperX64)) {
    throw new Error("InvalidMixedBoundedSnapshot");
  }
  if (
    header.sourceCount === 0 ||
    header.sourceCount > MAX_TWAP_AGGREGATION_SOURCES ||
    header.venueCount > MAX_TWAP_AGGREGATION_SOURCES ||
    header.correlationGroupCount > MAX_TWAP_AGGREGATION_SOURCES ||
    header.confidenceBps > 10_000 ||
    header.dispersionBps > 10_000 ||
    header.coverageRatioBps === 0 ||
    header.coverageRatioBps > 10_000 ||
    bitCountU64(header.sourceMask) < header.sourceCount
  ) {
    throw new Error("InvalidSnapshot");
  }
  if (
    header.capModelVersion !== CAP_MODEL_VERSION_V2 ||
    header.econLossBandBps !== CAP_MODEL_ECON_LOSS_BAND_BPS ||
    header.attackerSetWeightBps < CAP_MODEL_ATTACKER_WEIGHT_THRESHOLD_BPS ||
    header.attackerSetWeightBps > 10_000 ||
    header.attackerSetSourceCount === 0 ||
    header.attackerSetSourceCount > CAP_MODEL_MAX_SOURCES ||
    header.effectiveSourceCount === 0 ||
    header.effectiveSourceCount > CAP_MODEL_MAX_SOURCES ||
    header.attackerSetSourceCount > header.effectiveSourceCount ||
    ![6, 8, 10].includes(header.capTierSafetyFactor) ||
    header.attackerSourceMask === 0n ||
    header.attackerSetEconLossFloorNative === 0n ||
    header.attackerSetCapitalRequiredFloorNative === 0n ||
    !eqBytes(header.capModelHash, CAP_MODEL_HASH_V2)
  ) {
    throw new Error("InvalidSnapshot");
  }

  return withoutBlockClocks(header);
}

function withoutBlockClocks<T extends FeedSnapshotHeader>(header: T): T {
  return [1, 5, 6, 7].includes(header.snapshotSource)
    ? { ...header, oldestSourceActivitySlot: 0n, twapShortEndSlot: 0n, twapMediumEndSlot: 0n, twapLongEndSlot: 0n }
    : header;
}

export function validateEnum(value: number, maxInclusive: number): void {
  if (value > maxInclusive) throw new Error("InvalidEnum");
}

export function decodeFeedCollateralLockHeader(input: Uint8Array): FeedCollateralLockHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < FEED_COLLATERAL_LOCK_HEADER_LEN) throw new Error("InvalidAccountData");
  if (!eqBytes(data.subarray(FEED_COLLATERAL_LOCK_OFFSETS.magic, FEED_COLLATERAL_LOCK_OFFSETS.magic + 8),
    FEED_COLLATERAL_LOCK_MAGIC)) throw new Error("InvalidMagic");
  if (readU16(data, FEED_COLLATERAL_LOCK_OFFSETS.version) !== VERSION_V0) throw new Error("UnsupportedVersion");
  if (readU16(data, FEED_COLLATERAL_LOCK_OFFSETS.headerLen) !== FEED_COLLATERAL_LOCK_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }
  if (data.subarray(FEED_COLLATERAL_LOCK_OFFSETS.flags, FEED_COLLATERAL_LOCK_OFFSETS.feedId).some((byte) => byte !== 0) ||
    data.subarray(FEED_COLLATERAL_LOCK_OFFSETS.reservedTail, FEED_COLLATERAL_LOCK_HEADER_LEN).some((byte) => byte !== 0)) {
    throw new Error("InvalidFeedCollateralLock");
  }

  const header = {
    feedId: bytes32(data, FEED_COLLATERAL_LOCK_OFFSETS.feedId),
    creator: bytes32(data, FEED_COLLATERAL_LOCK_OFFSETS.creator),
    collateralMint: bytes32(data, FEED_COLLATERAL_LOCK_OFFSETS.collateralMint),
    lockedAmountRaw: readU64(data, FEED_COLLATERAL_LOCK_OFFSETS.lockedAmountRaw),
    createdSlot: readU64(data, FEED_COLLATERAL_LOCK_OFFSETS.createdSlot),
    createdUnixTs: readI64(data, FEED_COLLATERAL_LOCK_OFFSETS.createdUnixTs),
    adminConfigRevisionAtCreation: readU64(data, FEED_COLLATERAL_LOCK_OFFSETS.adminConfigRevisionAtCreation),
    status: data[FEED_COLLATERAL_LOCK_OFFSETS.status]!,
    bump: data[FEED_COLLATERAL_LOCK_OFFSETS.bump]!,
  };
  validateEnum(header.status, FeedCollateralLockStatus.OneCharGranted);
  if ((header.status !== FeedCollateralLockStatus.Locked && header.status !== FeedCollateralLockStatus.OneCharGranted) ||
    isZeroBytes(header.feedId) || isZeroBytes(header.creator) || isZeroBytes(header.collateralMint) ||
    (header.lockedAmountRaw === 0n) !== (header.status === FeedCollateralLockStatus.OneCharGranted) || header.createdSlot === 0n) {
    throw new Error("InvalidFeedCollateralLock");
  }
  return header;
}

export function decodeMimirBrowserCompositeSnapshotHeader(input: Uint8Array): CompositeSnapshotHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < COMPOSITE_SNAPSHOT_HEADER_LEN) throw new Error("InvalidAccountData");
  if (!eqBytes(data.subarray(COMPOSITE_SNAPSHOT_OFFSETS.magic, COMPOSITE_SNAPSHOT_OFFSETS.magic + 8), COMPOSITE_SNAPSHOT_MAGIC)) throw new Error("InvalidMagic");
  if (readU16(data, COMPOSITE_SNAPSHOT_OFFSETS.version) !== VERSION_V0) throw new Error("UnsupportedVersion");
  if (readU16(data, COMPOSITE_SNAPSHOT_OFFSETS.headerLen) !== COMPOSITE_SNAPSHOT_HEADER_LEN) throw new Error("InvalidHeaderLength");
  const flags = view(data).getUint32(COMPOSITE_SNAPSHOT_OFFSETS.flags, true);
  if (flags !== 0 && flags !== 1) throw new Error("InvalidCompositeSnapshot");
  const componentCount = data[COMPOSITE_SNAPSHOT_OFFSETS.componentCount]!;
  if (componentCount < MIN_COMPOSITE_COMPONENTS || componentCount > MAX_COMPOSITE_COMPONENTS) throw new Error("InvalidCompositeSnapshot");
  const components = [];
  for (let index = 0; index < componentCount; index += 1) {
    const offset = COMPOSITE_SNAPSHOT_OFFSETS.components + index * COMPOSITE_SNAPSHOT_COMPONENT_LEN;
    const component = {
      feedId: bytes32(data, offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.feedId),
      snapshotRevision: readU64(data, offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.snapshotRevision),
      snapshotSlot: readU64(data, offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.snapshotSlot),
      priceX64: readU128(data, offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.priceX64),
      contributionX64: readU128(data, offset + COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS.contributionX64),
    };
    if (isZeroBytes(component.feedId) || component.snapshotRevision === 0n || component.snapshotSlot === 0n || component.priceX64 === 0n || component.contributionX64 === 0n) throw new Error("InvalidCompositeSnapshot");
    components.push(component);
  }
  for (let index = componentCount; index < MAX_COMPOSITE_COMPONENTS; index += 1) {
    const offset = COMPOSITE_SNAPSHOT_OFFSETS.components + index * COMPOSITE_SNAPSHOT_COMPONENT_LEN;
    if (!isZeroBytes(data.subarray(offset, offset + COMPOSITE_SNAPSHOT_COMPONENT_LEN))) throw new Error("InvalidAccountData");
  }
  const header: CompositeSnapshotHeader = {
    flags,
    compositeFeedId: bytes32(data, COMPOSITE_SNAPSHOT_OFFSETS.feedId), compositeConfig: bytes32(data, COMPOSITE_SNAPSHOT_OFFSETS.compositeConfig),
    registryEpoch: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.registryEpoch), configRevision: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.configRevision),
    snapshotRevision: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.snapshotRevision), status: data[COMPOSITE_SNAPSHOT_OFFSETS.status]!,
    routeabilityStatus: data[COMPOSITE_SNAPSHOT_OFFSETS.routeabilityStatus]!, riskTier: data[COMPOSITE_SNAPSHOT_OFFSETS.riskTier]!,
    snapshotSource: data[COMPOSITE_SNAPSHOT_OFFSETS.snapshotSource]!, freshnessProfile: data[COMPOSITE_SNAPSHOT_OFFSETS.freshnessProfile]!,
    componentCount, quoteStatus: data[COMPOSITE_SNAPSHOT_OFFSETS.quoteStatus]!, snapshotSlot: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.snapshotSlot),
    validUntilSlot: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.validUntilSlot), snapshotUnixTs: readI64(data, COMPOSITE_SNAPSHOT_OFFSETS.snapshotUnixTs),
    oldestComponentSnapshotSlot: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.oldestComponentSnapshotSlot),
    oldestComponentActivitySlot: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.oldestComponentActivitySlot),
    priceMantissa: readU64(data, COMPOSITE_SNAPSHOT_OFFSETS.priceMantissa), priceExponent: view(data).getInt32(COMPOSITE_SNAPSHOT_OFFSETS.priceExponent, true),
    confidenceBps: readU16(data, COMPOSITE_SNAPSHOT_OFFSETS.confidenceBps), dispersionBps: readU16(data, COMPOSITE_SNAPSHOT_OFFSETS.dispersionBps),
    priceX64: readU128(data, COMPOSITE_SNAPSHOT_OFFSETS.priceX64), priceLowerX64: readU128(data, COMPOSITE_SNAPSHOT_OFFSETS.priceLowerX64),
    priceUpperX64: readU128(data, COMPOSITE_SNAPSHOT_OFFSETS.priceUpperX64), componentMinCapitalFloor: readU128(data, COMPOSITE_SNAPSHOT_OFFSETS.componentMinCapitalFloor),
    componentMinFeeLossFloor: readU128(data, COMPOSITE_SNAPSHOT_OFFSETS.componentMinFeeLossFloor), componentSetHash: bytes32(data, COMPOSITE_SNAPSHOT_OFFSETS.componentSetHash),
    componentSnapshotHash: bytes32(data, COMPOSITE_SNAPSHOT_OFFSETS.componentSnapshotHash), anchorProvider: data[COMPOSITE_SNAPSHOT_OFFSETS.anchorProvider]!,
    anchorStatus: data[COMPOSITE_SNAPSHOT_OFFSETS.anchorStatus]!, components,
  };
  validateEnum(header.status, SnapshotStatus.Fresh); validateEnum(header.routeabilityStatus, RouteabilityStatus.Disabled);
  validateEnum(header.riskTier, RiskTier.TierA); validateEnum(header.snapshotSource, SnapshotSource.Composite);
  validateEnum(header.freshnessProfile, FreshnessProfile.AnchorChecked); validateEnum(header.quoteStatus, QuoteStatus.Unknown);
  validateEnum(header.anchorProvider, AnchorProvider.NativeOnlyException); validateEnum(header.anchorStatus, AnchorStatus.InvalidVerification);
  if (isZeroBytes(header.compositeFeedId) || isZeroBytes(header.compositeConfig) || header.registryEpoch === 0n || isZeroBytes(header.componentSetHash) ||
      isZeroBytes(header.componentSnapshotHash) || header.status !== SnapshotStatus.Fresh || header.routeabilityStatus !== RouteabilityStatus.SafetyOnly ||
      header.riskTier !== RiskTier.Unrated || header.snapshotRevision === 0n || header.configRevision === 0n || header.snapshotSlot === 0n ||
      header.validUntilSlot < header.snapshotSlot || header.oldestComponentSnapshotSlot === 0n ||
      (header.oldestComponentActivitySlot === 0n && (header.freshnessProfile !== FreshnessProfile.Hot0 || header.quoteStatus !== QuoteStatus.Ok)) ||
      header.priceMantissa === 0n || header.priceX64 === 0n || header.priceLowerX64 === 0n || header.priceUpperX64 === 0n ||
      header.priceLowerX64 > header.priceX64 || header.priceX64 > header.priceUpperX64 || header.confidenceBps > 10_000 ||
      header.dispersionBps > 10_000 || header.snapshotSource !== SnapshotSource.Composite || header.anchorProvider !== AnchorProvider.None ||
      header.anchorStatus !== AnchorStatus.Missing) throw new Error("InvalidCompositeSnapshot");
  if (flags === 1 && (header.componentMinCapitalFloor !== 0n || header.componentMinFeeLossFloor !== 0n ||
    header.oldestComponentActivitySlot !== 0n)) throw new Error("InvalidCompositeSnapshot");
  return header;
}

/**
 * Composite publication: Fresh, or the program's Degraded CSP (status 1, routeability 5, any V1 condition, nonzero conditioned rows,
 * capacity 0), including the never-priced image. A Degraded CSP may carry an expired or zero `valid_until`.
 * `noPrice` (byte 319 = 2): no usable price (never priced). Otherwise the predecessor's price and clocks are carried, possibly expired.
 */
export type CompositePublicationHeader = CompositeSnapshotHeader & {
  degraded: Readonly<{ conditionFlags: number; powersMask: number; rowsMask: number; noPrice: boolean }> | null;
};

/** Exact Fresh or Degraded CSP shape; consumer admission stays Fresh-only through `decodeMimirBrowserCompositeSnapshotHeader`. */
export function decodeMimirBrowserCompositePublication(input: Uint8Array): CompositePublicationHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const zero = (a: number, b: number) => data.subarray(a, b).every((x) => x === 0);
  if (data.length !== COMPOSITE_SNAPSHOT_HEADER_LEN) throw new Error("InvalidAccountData");
  if (data[COMPOSITE_SNAPSHOT_OFFSETS.status] === SnapshotStatus.Fresh) {
    const header = decodeMimirBrowserCompositeSnapshotHeader(data);
    if (!zero(314, 320)) throw new Error("InvalidCompositeSnapshot");
    return { ...header, degraded: null };
  }
  const conditionFlags = readU16(data, 314), powersMask = readU16(data, 316), rowsMask = data[318]!, noPrice = data[319] === 2;
  if (data[COMPOSITE_SNAPSHOT_OFFSETS.status] !== 1 || data[COMPOSITE_SNAPSHOT_OFFSETS.routeabilityStatus] !== RouteabilityStatus.Disabled ||
      conditionFlags === 0 || (conditionFlags & ~MIMIR_V1_COND_MASK) !== 0 || (powersMask & ~MIMIR_V1_POWERS_MASK) !== 0 ||
      (data[319] !== 0 && !noPrice) || rowsMask === 0 || !zero(216, 248)) throw new Error("InvalidCompositeSnapshot");
  const degraded = { conditionFlags, powersMask, rowsMask, noPrice };
  const n = data[COMPOSITE_SNAPSHOT_OFFSETS.componentCount]!;
  if (noPrice && zero(168, 184)) {
    if (!eqBytes(data.subarray(0, 8), COMPOSITE_SNAPSHOT_MAGIC) || readU16(data, 8) !== VERSION_V0 || readU16(data, 10) !== COMPOSITE_SNAPSHOT_HEADER_LEN ||
        n < MIN_COMPOSITE_COMPONENTS || n > MAX_COMPOSITE_COMPONENTS || !zero(12, 16) || data[106] !== RiskTier.Unrated ||
        data[107] !== SnapshotSource.Composite || data[108] !== FreshnessProfile.Hot0 || data[110] !== QuoteStatus.Ok || data[111] !== 0 ||
        !zero(120, 128) || !zero(136, 160) || !zero(164, 216) || !zero(280, 312) || data[312] !== AnchorProvider.None ||
        data[313] !== AnchorStatus.Missing || !zero(320, data.length) || zero(16, 48) || zero(48, 80) || readU64(data, 80) === 0n ||
        zero(248, 280) || readU64(data, 96) === 0n || readU64(data, 88) === 0n || readU64(data, 112) === 0n) throw new Error("InvalidCompositeSnapshot");
    return { flags: 0, compositeFeedId: bytes32(data, 16), compositeConfig: bytes32(data, 48), registryEpoch: readU64(data, 80),
      configRevision: readU64(data, 88), snapshotRevision: readU64(data, 96), status: 1, routeabilityStatus: RouteabilityStatus.Disabled,
      riskTier: RiskTier.Unrated, snapshotSource: SnapshotSource.Composite, freshnessProfile: FreshnessProfile.Hot0, componentCount: n,
      quoteStatus: QuoteStatus.Ok, snapshotSlot: readU64(data, 112), validUntilSlot: 0n, snapshotUnixTs: readI64(data, 128),
      oldestComponentSnapshotSlot: 0n, oldestComponentActivitySlot: 0n, priceMantissa: 0n, priceExponent: view(data).getInt32(160, true),
      confidenceBps: 0, dispersionBps: 0, priceX64: 0n, priceLowerX64: 0n, priceUpperX64: 0n, componentMinCapitalFloor: 0n,
      componentMinFeeLossFloor: 0n, componentSetHash: bytes32(data, 248), componentSnapshotHash: new Uint8Array(32),
      anchorProvider: AnchorProvider.None, anchorStatus: AnchorStatus.Missing, components: [], degraded };
  }
  const asFresh = Uint8Array.from(data); asFresh[COMPOSITE_SNAPSHOT_OFFSETS.status] = SnapshotStatus.Fresh; asFresh[COMPOSITE_SNAPSHOT_OFFSETS.routeabilityStatus] = RouteabilityStatus.SafetyOnly;
  const validUntilSlot = readU64(data, 120);
  if (validUntilSlot < readU64(data, 112)) asFresh.set(data.subarray(112, 120), 120);
  const header = decodeMimirBrowserCompositeSnapshotHeader(asFresh);
  return { ...header, status: 1, routeabilityStatus: RouteabilityStatus.Disabled, validUntilSlot, degraded };
}

export function bitCountU64(value: bigint): number {
  let count = 0;
  let remaining = value;
  while (remaining > 0n) {
    count += Number(remaining & 1n);
    remaining >>= 1n;
  }
  return count;
}

export function decodeFeedTwapStateHeader(input: Uint8Array): FeedTwapStateHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < FEED_TWAP_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (readU16(data, TWAP_OFFSETS.headerLen) !== FEED_TWAP_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }
  if (!eqBytes(data.subarray(TWAP_OFFSETS.magic, TWAP_OFFSETS.magic + 8), FEED_TWAP_MAGIC)) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, TWAP_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }

  const sourceTableCount = data[TWAP_OFFSETS.sourceTableCount];
  if (sourceTableCount === 0) {
    throw new Error("InvalidTwapState");
  }

  const header = {
    feedId: bytes32(data, TWAP_OFFSETS.feedId),
    twapVersion: readU16(data, TWAP_OFFSETS.twapVersion),
    status: data[TWAP_OFFSETS.status],
    freshnessProfile: data[TWAP_OFFSETS.freshnessProfile],
    shortEndSlot: readU64(data, TWAP_OFFSETS.shortEndSlot),
    mediumEndSlot: readU64(data, TWAP_OFFSETS.mediumEndSlot),
    longEndSlot: readU64(data, TWAP_OFFSETS.longEndSlot),
    twapShortX64: readU128(data, TWAP_OFFSETS.twapShortX64),
    twapMediumX64: readU128(data, TWAP_OFFSETS.twapMediumX64),
    twapLongX64: readU128(data, TWAP_OFFSETS.twapLongX64),
    coverageRatioBps: readU16(data, TWAP_OFFSETS.coverageRatioBps),
    sourceActivitySlotMin: readU64(data, TWAP_OFFSETS.sourceActivitySlotMin),
    sourceMask: readU64(data, TWAP_OFFSETS.sourceMask),
    unknownActivitySourceMask: readU64(data, TWAP_OFFSETS.unknownActivitySourceMask),
    sanityMinDepthTo50BpsWindow: readU128(data, TWAP_OFFSETS.sanityMinDepthTo50BpsWindow),
    sanityFeeLossFloorWindow: readU128(data, TWAP_OFFSETS.sanityFeeLossFloorWindow),
    selectedPlanHash: bytes32(data, TWAP_OFFSETS.selectedPlanHash),
    correlationMaskHash: bytes32(data, TWAP_OFFSETS.correlationMaskHash),
    revision: readU64(data, TWAP_OFFSETS.revision),
    sourceSetRevision: readU64(data, TWAP_OFFSETS.sourceSetRevision),
    bump: data[TWAP_OFFSETS.bump],
    maxConfidenceBps: readU16(data, TWAP_OFFSETS.maxConfidenceBps),
    maxDispersionBps: readU16(data, TWAP_OFFSETS.maxDispersionBps),
    attackerSetEconLossFloorWindowNative: readU128(
      data,
      TWAP_OFFSETS.attackerSetEconLossFloorWindowNative,
    ),
    attackerSetCapitalRequiredFloorWindowNative: readU128(
      data,
      TWAP_OFFSETS.attackerSetCapitalRequiredFloorWindowNative,
    ),
    attackerSetWeightBps: readU16(data, TWAP_OFFSETS.attackerSetWeightBps),
    attackerSetSourceCount: data[TWAP_OFFSETS.attackerSetSourceCount],
    effectiveSourceCount: data[TWAP_OFFSETS.effectiveSourceCount],
    capModelFlags: readU16(data, TWAP_OFFSETS.capModelFlags),
    econLossBandBps: readU16(data, TWAP_OFFSETS.econLossBandBps),
    attackerSourceMask: readU64(data, TWAP_OFFSETS.attackerSourceMask),
    sourceTableCount,
    sourceCapEntries: decodeSourceCapEntriesV2(
      data,
      TWAP_OFFSETS.sourceTable,
      sourceTableCount,
    ),
  };

  validateEnum(header.status, TwapStatus.Paused);
  validateEnum(header.freshnessProfile, FreshnessProfile.AnchorChecked);
  const zero = new Uint8Array(32);
  if (
    header.coverageRatioBps > 10_000 ||
    header.maxConfidenceBps > 10_000 ||
    header.maxDispersionBps > 10_000 ||
    header.sourceActivitySlotMin === 0n ||
    header.sourceMask === 0n ||
    header.twapShortX64 === 0n ||
    header.twapMediumX64 === 0n ||
    header.twapLongX64 === 0n ||
    header.sanityMinDepthTo50BpsWindow === 0n ||
    header.sanityFeeLossFloorWindow === 0n ||
    eqBytes(header.selectedPlanHash, zero) ||
    eqBytes(header.correlationMaskHash, zero)
  ) {
    throw new Error("InvalidTwapState");
  }
  if (
    header.attackerSetEconLossFloorWindowNative === 0n ||
    header.attackerSetCapitalRequiredFloorWindowNative === 0n ||
    header.attackerSetWeightBps < CAP_MODEL_ATTACKER_WEIGHT_THRESHOLD_BPS ||
    header.attackerSetWeightBps > 10_000 ||
    header.attackerSetSourceCount === 0 ||
    header.attackerSetSourceCount > CAP_MODEL_MAX_SOURCES ||
    header.effectiveSourceCount === 0 ||
    header.effectiveSourceCount > CAP_MODEL_MAX_SOURCES ||
    header.attackerSetSourceCount > header.effectiveSourceCount ||
    header.econLossBandBps !== CAP_MODEL_ECON_LOSS_BAND_BPS ||
    header.attackerSourceMask === 0n ||
    header.sourceTableCount === 0 ||
    header.sourceTableCount > CAP_MODEL_MAX_SOURCES ||
    !validCapModelSourceTable({
      sourceMask: header.sourceMask,
      attackerSetEconLossFloorNative:
        header.attackerSetEconLossFloorWindowNative,
      attackerSetCapitalRequiredFloorNative:
        header.attackerSetCapitalRequiredFloorWindowNative,
      attackerSetWeightBps: header.attackerSetWeightBps,
      attackerSetSourceCount: header.attackerSetSourceCount,
      effectiveSourceCount: header.effectiveSourceCount,
      attackerSourceMask: header.attackerSourceMask,
      sourceTableCount: header.sourceTableCount,
      sourceCapEntries: header.sourceCapEntries,
    })
  ) {
    throw new Error("InvalidTwapState");
  }
  return header;
}

export function decodeSourceCapEntriesV2(
  data: Uint8Array,
  tableOffset: number,
  sourceTableCount: number,
): SourceCapEntryV2[] {
  if (sourceTableCount > CAP_MODEL_MAX_SOURCES) {
    throw new Error("InvalidAccountData");
  }
  const entries: SourceCapEntryV2[] = [];
  for (let index = 0; index < CAP_MODEL_MAX_SOURCES; index += 1) {
    const offset = tableOffset + index * CAP_MODEL_SOURCE_ENTRY_LEN;
    if (index >= sourceTableCount) {
      if (
        !isZeroBytes(data.subarray(offset, offset + CAP_MODEL_SOURCE_ENTRY_LEN))
      ) {
        throw new Error("InvalidAccountData");
      }
      continue;
    }
    entries.push({
      sourceIndex: data[offset + SOURCE_CAP_ENTRY_OFFSETS.sourceIndex],
      flags: data[offset + SOURCE_CAP_ENTRY_OFFSETS.flags],
      weightBps: readU16(data, offset + SOURCE_CAP_ENTRY_OFFSETS.weightBps),
      routeCorrelationGroup: readU16(
        data,
        offset + SOURCE_CAP_ENTRY_OFFSETS.routeCorrelationGroup,
      ),
      econLossFloorNative: readU128(
        data,
        offset + SOURCE_CAP_ENTRY_OFFSETS.econLossFloorNative,
      ),
      capitalRequiredFloorNative: readU128(
        data,
        offset + SOURCE_CAP_ENTRY_OFFSETS.capitalRequiredFloorNative,
      ),
      sourceSetRevision: readU64(
        data,
        offset + SOURCE_CAP_ENTRY_OFFSETS.sourceSetRevision,
      ),
    });
  }
  return entries;
}

export function validCapModelSourceTable(header: {
  sourceMask: bigint;
  attackerSetEconLossFloorNative: bigint;
  attackerSetCapitalRequiredFloorNative: bigint;
  attackerSetWeightBps: number;
  attackerSetSourceCount: number;
  effectiveSourceCount: number;
  attackerSourceMask: bigint;
  sourceTableCount: number;
  sourceCapEntries: readonly SourceCapEntryV2[];
}): boolean {
  if (header.sourceCapEntries.length !== header.sourceTableCount) return false;

  let selectedCount = 0;
  let selectedWeightBps = 0;
  let selectedEconLossFloorNative = 0n;
  let selectedCapitalRequiredFloorNative = 0n;
  let selectedMask = 0n;

  for (const entry of header.sourceCapEntries) {
    if (
      entry.weightBps === 0 ||
      entry.weightBps > 10_000 ||
      entry.econLossFloorNative === 0n ||
      entry.capitalRequiredFloorNative === 0n ||
      entry.sourceSetRevision === 0n ||
      entry.sourceIndex > MAX_SOURCE_INDEX
    ) {
      return false;
    }
    const bit = 1n << BigInt(entry.sourceIndex);
    if ((header.sourceMask & bit) === 0n) {
      return false;
    }
    if ((entry.flags & 1) === 0) continue;
    if ((selectedMask & bit) !== 0n) return false;

    const nextWeightBps = selectedWeightBps + entry.weightBps;
    const nextEconLossFloorNative =
      selectedEconLossFloorNative + entry.econLossFloorNative;
    const nextCapitalRequiredFloorNative =
      selectedCapitalRequiredFloorNative + entry.capitalRequiredFloorNative;
    if (
      nextWeightBps > 0xffff ||
      nextEconLossFloorNative > U128_MAX ||
      nextCapitalRequiredFloorNative > U128_MAX
    ) {
      return false;
    }
    selectedCount += 1;
    selectedWeightBps = nextWeightBps;
    selectedEconLossFloorNative = nextEconLossFloorNative;
    selectedCapitalRequiredFloorNative = nextCapitalRequiredFloorNative;
    selectedMask |= bit;
  }

  return (
    selectedCount === header.attackerSetSourceCount &&
    selectedWeightBps === header.attackerSetWeightBps &&
    selectedEconLossFloorNative === header.attackerSetEconLossFloorNative &&
    selectedCapitalRequiredFloorNative ===
      header.attackerSetCapitalRequiredFloorNative &&
    selectedMask === header.attackerSourceMask &&
    selectedWeightBps >= CAP_MODEL_ATTACKER_WEIGHT_THRESHOLD_BPS &&
    selectedCount <= header.effectiveSourceCount
  );
}

export function decodeLifecycleFeedConfigHeader(
  input: Uint8Array,
): LifecycleFeedConfigHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  const version = data.length >= 12 ? readU16(data, CONFIG_OFFSETS.version) : -1;
  if (
    version !== VERSION_V1 ||
    data.length !== FEED_CONFIG_V1_HEADER_LEN ||
    readU16(data, CONFIG_OFFSETS.headerLen) !== FEED_CONFIG_V1_HEADER_LEN
  ) {
    throw new Error("InvalidLifecycleFeedConfig");
  }
  const legacy = Uint8Array.from(data.subarray(0, FEED_CONFIG_HEADER_LEN));
  view(legacy).setUint16(CONFIG_OFFSETS.version, VERSION_V0, true);
  view(legacy).setUint16(CONFIG_OFFSETS.headerLen, FEED_CONFIG_HEADER_LEN, true);
  const header = decodeFeedConfigPrefix(legacy);
  const identityAsset = bytes32(data, FEED_CONFIG_IDENTITY_ASSET_OFFSET);
  if (isZeroBytes(identityAsset)) {
    throw new Error("InvalidLifecycleFeedConfig");
  }
  return { ...header, identityAsset };
}

export function decodeFeedConfigHeader(input: Uint8Array): FeedConfigHeader {
  return decodeLifecycleFeedConfigHeader(input);
}

function decodeFeedConfigPrefix(input: Uint8Array): FeedConfigHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < FEED_CONFIG_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (!eqBytes(data.subarray(CONFIG_OFFSETS.magic, CONFIG_OFFSETS.magic + 8), FEED_CONFIG_MAGIC)) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, CONFIG_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (readU16(data, CONFIG_OFFSETS.headerLen) !== FEED_CONFIG_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }

  const header = {
    feedId: bytes32(data, CONFIG_OFFSETS.feedId),
    baseMint: bytes32(data, CONFIG_OFFSETS.baseMint),
    quoteMint: bytes32(data, CONFIG_OFFSETS.quoteMint),
    priceExponent: view(data).getInt32(CONFIG_OFFSETS.priceExponent, true),
    riskTier: data[CONFIG_OFFSETS.riskTier],
    lifecycleState: data[CONFIG_OFFSETS.lifecycleState],
    baseDecimals: data[CONFIG_OFFSETS.baseDecimals],
    quoteDecimals: data[CONFIG_OFFSETS.quoteDecimals],
    minSourceCount: data[CONFIG_OFFSETS.minSourceCount],
    minVenueCount: data[CONFIG_OFFSETS.minVenueCount],
    minCorrelationGroupCount: data[CONFIG_OFFSETS.minCorrelationGroupCount],
    minCoverageRatioBps: readU16(data, CONFIG_OFFSETS.minCoverageRatioBps),
    maxConfidenceBps: readU16(data, CONFIG_OFFSETS.maxConfidenceBps),
    maxDispersionBps: readU16(data, CONFIG_OFFSETS.maxDispersionBps),
    maxSnapshotAgeSlots: readU16(data, CONFIG_OFFSETS.maxSnapshotAgeSlots),
    maxSourceActivityAgeSlots: readU16(data, CONFIG_OFFSETS.maxSourceActivityAgeSlots),
    sourceSetHash: bytes32(data, CONFIG_OFFSETS.sourceSetHash),
    defaultSourcingPlan: bytes32(data, CONFIG_OFFSETS.defaultSourcingPlan),
    fallbackSourcingPlan: bytes32(data, CONFIG_OFFSETS.fallbackSourcingPlan),
    anchorPolicyHash: bytes32(data, CONFIG_OFFSETS.anchorPolicyHash),
    nativeExceptionHash: bytes32(data, CONFIG_OFFSETS.nativeExceptionHash),
    feedConfigRevision: readU64(data, CONFIG_OFFSETS.feedConfigRevision),
    registryEpoch: readU64(data, CONFIG_OFFSETS.registryEpoch),
    bump: data[CONFIG_OFFSETS.bump],
  };

  validateEnum(header.riskTier, RiskTier.TierA);
  validateEnum(header.lifecycleState, FeedLifecycleState.Halted);
  if (
    isZeroBytes(header.baseMint) ||
    isZeroBytes(header.quoteMint) ||
    eqBytes(header.baseMint, header.quoteMint) ||
    header.minCoverageRatioBps > 10_000 ||
    header.maxConfidenceBps > 10_000 ||
    header.maxDispersionBps > 10_000
  ) {
    throw new Error("InvalidFeedConfig");
  }

  return header;
}

export function decodeOracleRegistryHeader(input: Uint8Array): OracleRegistryHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < ORACLE_REGISTRY_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (!eqBytes(data.subarray(REGISTRY_OFFSETS.magic, REGISTRY_OFFSETS.magic + 8), ORACLE_REGISTRY_MAGIC)) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, REGISTRY_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (readU16(data, REGISTRY_OFFSETS.headerLen) !== ORACLE_REGISTRY_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }
  const supportedAdapterVersionMasks: number[] = [];
  for (let i = 0; i < REGISTRY_ADAPTER_VERSION_MASK_COUNT; i += 1) {
    supportedAdapterVersionMasks.push(
      readU16(
        data,
        REGISTRY_OFFSETS.adapterVersionMasks +
          i * REGISTRY_ADAPTER_VERSION_MASK_BYTES,
      ),
    );
  }

  const header = {
    authority: bytes32(data, REGISTRY_OFFSETS.authority),
    emergencyAuthority: bytes32(data, REGISTRY_OFFSETS.emergencyAuthority),
    supportedAdapterMask: readU64(data, REGISTRY_OFFSETS.supportedAdapterMask),
    supportedAdapterVersionMasks,
    minFeedConfigVersion: readU16(data, REGISTRY_OFFSETS.minFeedConfigVersion),
    registryEpoch: readU64(data, REGISTRY_OFFSETS.registryEpoch),
    status: data[REGISTRY_OFFSETS.status],
    bump: data[REGISTRY_OFFSETS.bump],
  };

  validateEnum(header.status, RegistryStatus.Paused);
  return header;
}

export function decodeSourcingPlanHeader(input: Uint8Array): SourcingPlanHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < SOURCING_PLAN_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (!eqBytes(data.subarray(PLAN_OFFSETS.magic, PLAN_OFFSETS.magic + 8), SOURCING_PLAN_MAGIC)) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, PLAN_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (readU16(data, PLAN_OFFSETS.headerLen) !== SOURCING_PLAN_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }

  const header = {
    feedId: bytes32(data, PLAN_OFFSETS.feedId),
    planId: readU16(data, PLAN_OFFSETS.planId),
    planVersion: readU16(data, PLAN_OFFSETS.planVersion),
    profile: data[PLAN_OFFSETS.profile],
    status: data[PLAN_OFFSETS.status],
    riskTier: data[PLAN_OFFSETS.riskTier],
    minSources: data[PLAN_OFFSETS.minSources],
    minVenues: data[PLAN_OFFSETS.minVenues],
    minCorrelationGroups: data[PLAN_OFFSETS.minCorrelationGroups],
    maxDispersionBps: readU16(data, PLAN_OFFSETS.maxDispersionBps),
    maxSourceActivityAgeSlots: readU16(data, PLAN_OFFSETS.maxSourceActivityAgeSlots),
    priceExponent: view(data).getInt32(PLAN_OFFSETS.priceExponent, true),
    baseMint: bytes32(data, PLAN_OFFSETS.baseMint),
    quoteMint: bytes32(data, PLAN_OFFSETS.quoteMint),
    sourceSetHash: bytes32(data, PLAN_OFFSETS.sourceSetHash),
    accountsHash: bytes32(data, PLAN_OFFSETS.accountsHash),
    planHash: bytes32(data, PLAN_OFFSETS.planHash),
    twapState: bytes32(data, PLAN_OFFSETS.twapState),
    anchorPolicyHash: bytes32(data, PLAN_OFFSETS.anchorPolicyHash),
    adapterMask: readU64(data, PLAN_OFFSETS.adapterMask),
    bump: data[PLAN_OFFSETS.bump],
  };

  validateEnum(header.profile, PlanProfile.Deep);
  validateEnum(header.status, PlanStatus.Paused);
  validateEnum(header.riskTier, RiskTier.TierA);
  if (
    isZeroBytes(header.baseMint) ||
    isZeroBytes(header.quoteMint) ||
    eqBytes(header.baseMint, header.quoteMint)
  ) {
    throw new Error("InvalidPlan");
  }
  if (header.maxDispersionBps > 10_000) throw new Error("InvalidPlan");
  return header;
}

export function decodeSourceConfigHeader(input: Uint8Array): SourceConfigHeader {
  const data = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < SOURCE_CONFIG_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (!eqBytes(data.subarray(SOURCE_OFFSETS.magic, SOURCE_OFFSETS.magic + 8), SOURCE_CONFIG_MAGIC)) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, SOURCE_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (readU16(data, SOURCE_OFFSETS.headerLen) !== SOURCE_CONFIG_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }

  const header = {
    feedId: bytes32(data, SOURCE_OFFSETS.feedId),
    sourceIndex: data[SOURCE_OFFSETS.sourceIndex],
    adapterType: data[SOURCE_OFFSETS.adapterType],
    status: data[SOURCE_OFFSETS.status],
    direction: data[SOURCE_OFFSETS.direction],
    adapterVersion: readU16(data, SOURCE_OFFSETS.adapterVersion),
    venueGroup: readU16(data, SOURCE_OFFSETS.venueGroup),
    operatorGroup: readU16(data, SOURCE_OFFSETS.operatorGroup),
    liquidityOwnerGroup: readU16(data, SOURCE_OFFSETS.liquidityOwnerGroup),
    routeCorrelationGroup: readU16(data, SOURCE_OFFSETS.routeCorrelationGroup),
    quoteAssetGroup: readU16(data, SOURCE_OFFSETS.quoteAssetGroup),
    bridgeOrWrapperGroup: readU16(data, SOURCE_OFFSETS.bridgeOrWrapperGroup),
    oracleSourceClass: readU16(data, SOURCE_OFFSETS.oracleSourceClass),
    upgradeAuthorityGroup: readU16(data, SOURCE_OFFSETS.upgradeAuthorityGroup),
    maxSourceWeightBps: readU16(data, SOURCE_OFFSETS.maxSourceWeightBps),
    minLiquidityNative: readU128(data, SOURCE_OFFSETS.minLiquidityNative),
    minDepthTo50BpsNative: readU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative),
    programId: bytes32(data, SOURCE_OFFSETS.programId),
    poolOrMarket: bytes32(data, SOURCE_OFFSETS.poolOrMarket),
    baseVault: bytes32(data, SOURCE_OFFSETS.baseVault),
    quoteVault: bytes32(data, SOURCE_OFFSETS.quoteVault),
    baseMint: bytes32(data, SOURCE_OFFSETS.baseMint),
    quoteMint: bytes32(data, SOURCE_OFFSETS.quoteMint),
    tokenProgram: bytes32(data, SOURCE_OFFSETS.tokenProgram),
    vaultAuthority: bytes32(data, SOURCE_OFFSETS.vaultAuthority),
    sourceConfigRevision: readU64(data, SOURCE_OFFSETS.sourceConfigRevision),
    sourceSetRevision: readU64(data, SOURCE_OFFSETS.sourceSetRevision),
    bump: data[SOURCE_OFFSETS.bump],
    flags: readU32(data, SOURCE_OFFSETS.flags),
    temporalMode: "sampled-interval" as MimirTemporalMode,
  };

  if (!isKnownSourceAdapterType(header.adapterType)) throw new Error("InvalidEnum");
  header.temporalMode = mimirTemporalModeFromSourceFlags(header.flags, header.adapterType, header.adapterVersion);
  validateEnum(header.status, SourceStatus.Paused);
  validateEnum(header.direction, SourceDirection.QuotePerBase);
  if (header.sourceIndex > MAX_SOURCE_INDEX) throw new Error("InvalidSourceConfig");
  if (header.maxSourceWeightBps === 0 || header.maxSourceWeightBps > 10_000) {
    throw new Error("InvalidSourceConfig");
  }
  const zero = new Uint8Array(32);
  if (
    header.minLiquidityNative === 0n ||
    header.minDepthTo50BpsNative === 0n ||
    eqBytes(header.programId, zero) ||
    eqBytes(header.poolOrMarket, zero) ||
    eqBytes(header.baseMint, zero) ||
    eqBytes(header.quoteMint, zero) ||
    eqBytes(header.baseMint, header.quoteMint)
  ) {
    throw new Error("InvalidSourceConfig");
  }

  return header;
}

export function readRaydiumCpmmPoolObservationKey(poolStateData: Uint8Array): Bytes32 {
  const data = new Uint8Array(poolStateData.buffer, poolStateData.byteOffset, poolStateData.byteLength);
  if (
    data.length <= RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET + 31 ||
    !eqBytes(
      data.subarray(0, RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR.length),
      RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
    )
  ) {
    throw new Error("InvalidRaydiumCpmmPoolState");
  }
  return bytes32(data, RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET);
}

export function readMeteoraDlmmPoolObservationKey(poolStateData: Uint8Array): Bytes32 {
  const data = new Uint8Array(poolStateData.buffer, poolStateData.byteOffset, poolStateData.byteLength);
  if (data.length !== 904 || !eqBytes(data.subarray(0, 8), METEORA_DLMM_POOL_DISCRIMINATOR)) {
    throw new Error("InvalidMeteoraDlmmPoolState");
  }
  return bytes32(data, 552);
}

export function readRaydiumCpmmPoolAmmConfig(poolStateData: Uint8Array): Bytes32 {
  const data = new Uint8Array(poolStateData.buffer, poolStateData.byteOffset, poolStateData.byteLength);
  if (
    data.length <= RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG + 31 ||
    !eqBytes(
      data.subarray(0, RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR.length),
      RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
    )
  ) {
    throw new Error("InvalidRaydiumCpmmPoolState");
  }
  return bytes32(data, RAYDIUM_CPMM_POOL_OFFSET_AMM_CONFIG);
}

export function raydiumCpmmPoolToken0IsBaseForFeed(
  poolStateData: Uint8Array,
  feedConfig: FeedConfigHeader,
  sourceConfig: SourceConfigHeader,
): boolean {
  return raydiumCpmmPoolToken0IsBase(poolStateData, sourceConfig, feedConfig);
}

export function raydiumCpmmPoolToken0IsBase(
  poolStateData: Uint8Array,
  sourceConfig: SourceConfigHeader,
  feedConfig: FeedConfigHeader,
): boolean {
  const data = new Uint8Array(poolStateData.buffer, poolStateData.byteOffset, poolStateData.byteLength);
  if (
    data.length < RAYDIUM_CPMM_POOL_MIN_TOKEN_READABLE_LEN ||
    !eqBytes(
      data.subarray(0, RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR.length),
      RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
    ) ||
    (data[RAYDIUM_CPMM_POOL_OFFSET_STATUS] &
      RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK) !==
      0
  ) {
    throw new Error("InvalidRaydiumCpmmPoolState");
  }
  const token0Vault = bytes32(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT);
  const token1Vault = bytes32(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT);
  const token0Mint = bytes32(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT);
  const token1Mint = bytes32(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT);
  const token0Program = bytes32(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM);
  const token1Program = bytes32(data, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM);
  const splTokenProgram = addressBytes(SPL_TOKEN_PROGRAM_ID);
  if (
    !eqBytes(token0Program, splTokenProgram) ||
    !eqBytes(token1Program, splTokenProgram) ||
    !eqBytes(token0Program, sourceConfig.tokenProgram) ||
    !eqBytes(token1Program, sourceConfig.tokenProgram)
  ) {
    throw new Error("InvalidSourceConfig");
  }
  const token0IsBase =
    eqBytes(token0Vault, sourceConfig.baseVault) &&
    eqBytes(token1Vault, sourceConfig.quoteVault) &&
    eqBytes(token0Mint, sourceConfig.baseMint) &&
    eqBytes(token1Mint, sourceConfig.quoteMint);
  const token1IsBase =
    eqBytes(token1Vault, sourceConfig.baseVault) &&
    eqBytes(token0Vault, sourceConfig.quoteVault) &&
    eqBytes(token1Mint, sourceConfig.baseMint) &&
    eqBytes(token0Mint, sourceConfig.quoteMint);
  if (!token0IsBase && !token1IsBase) {
    throw new Error("InvalidSourceConfig");
  }
  const mint0Decimals = data[RAYDIUM_CPMM_POOL_OFFSET_MINT_0_DECIMALS];
  const mint1Decimals = data[RAYDIUM_CPMM_POOL_OFFSET_MINT_1_DECIMALS];
  if (
    token0IsBase &&
    (mint0Decimals !== feedConfig.baseDecimals ||
      mint1Decimals !== feedConfig.quoteDecimals)
  ) {
    throw new Error("InvalidSourceConfig");
  }
  if (
    token1IsBase &&
    (mint1Decimals !== feedConfig.baseDecimals ||
      mint0Decimals !== feedConfig.quoteDecimals)
  ) {
    throw new Error("InvalidSourceConfig");
  }
  return token0IsBase;
}

export function extractRaydiumCpmmNativeTwapObservationSample(params: {
  observationState: Uint8Array;
  observationStateAddress: Uint8Array;
  expectedPoolState?: Uint8Array;
  windowSecs: bigint;
  currentTimestamp?: bigint;
  maxNativeLastUpdateAgeSecs?: bigint;
}): RaydiumCpmmNativeTwapObservationSample {
  const data = new Uint8Array(params.observationState.buffer, params.observationState.byteOffset, params.observationState.byteLength);
  if (
    data.length !== RAYDIUM_CPMM_OBSERVATION_STATE_LEN ||
    params.observationStateAddress.length !== 32 ||
    !eqBytes(
      data.subarray(0, RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR.length),
      RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR,
    ) ||
    data[RAYDIUM_CPMM_OBSERVATION_STATE_INITIALIZED_OFFSET] === 0
  ) {
    throw new Error("InvalidRaydiumCpmmObservationState");
  }
  if (
    params.expectedPoolState &&
    !eqBytes(
      data.subarray(
        RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET,
        RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET + 32,
      ),
      params.expectedPoolState,
    )
  ) {
    throw new Error("InvalidRaydiumCpmmObservationState");
  }
  const observationIndex = readU16(data, RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET);
  if (observationIndex >= RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT) {
    throw new Error("InvalidRaydiumCpmmObservationState");
  }
  const latestOffset = raydiumCpmmObservationOffset(observationIndex);
  const lastUpdateTimestamp = readU64(
    data,
    RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
  );
  const latestBlockTimestamp = readU64(
    data,
    latestOffset + RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET,
  );
  if (lastUpdateTimestamp === 0n || latestBlockTimestamp === 0n) {
    throw new Error("InvalidRaydiumCpmmObservationState");
  }
  if (params.windowSecs <= 0n) {
    throw new Error("InvalidTwapState");
  }
  if (
    params.currentTimestamp !== undefined &&
    lastUpdateTimestamp > params.currentTimestamp
  ) {
    throw new Error("StaleSourceActivity");
  }
  const orderedObservations: Array<{ timestamp: bigint; offset: number }> = [];
  for (
    let distance = 1;
    distance <= RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT;
    distance += 1
  ) {
    const index =
      (observationIndex + distance) %
      RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT;
    const offset = raydiumCpmmObservationOffset(index);
    const timestamp = readU64(
      data,
      offset + RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET,
    );
    if (timestamp === 0n) continue;
    if (timestamp > lastUpdateTimestamp) {
      throw new Error("InvalidTwapState");
    }
    const previous = orderedObservations.at(-1);
    if (previous && timestamp <= previous.timestamp) {
      throw new Error("InvalidTwapState");
    }
    orderedObservations.push({ timestamp, offset });
  }
  if (
    orderedObservations.length === 0 ||
    orderedObservations.at(-1)?.offset !== latestOffset
  ) {
    throw new Error("InvalidTwapState");
  }
  const oldestTimestamp = orderedObservations[0]!.timestamp;
  const observedSpanSecs = lastUpdateTimestamp - oldestTimestamp;
  if (observedSpanSecs < params.windowSecs) {
    throw new RaydiumCpmmNativeTwapWindowWarmingError(
      observedSpanSecs,
      params.windowSecs,
    );
  }
  const targetTimestamp = lastUpdateTimestamp - params.windowSecs;
  let oldTimestamp = 0n;
  let oldOffset = -1;
  for (const observation of orderedObservations) {
    if (
      observation.timestamp <= targetTimestamp &&
      observation.timestamp > oldTimestamp
    ) {
      oldTimestamp = observation.timestamp;
      oldOffset = observation.offset;
    }
  }
  if (oldTimestamp === 0n || oldOffset < 0 || oldOffset === latestOffset) {
    throw new Error("InvalidTwapState");
  }
  if (lastUpdateTimestamp <= oldTimestamp) {
    throw new Error("InvalidTwapState");
  }
  if (
    params.currentTimestamp !== undefined &&
    params.maxNativeLastUpdateAgeSecs !== undefined &&
    params.currentTimestamp - lastUpdateTimestamp >
      params.maxNativeLastUpdateAgeSecs
  ) {
    throw new Error("StaleSourceActivity");
  }
  return {
    observationState: bytes32(Uint8Array.from(params.observationStateAddress), 0),
    oldTimestamp,
    newTimestamp: lastUpdateTimestamp,
    lastUpdateTimestamp,
    oldCumulativeToken0PriceX32: readU128(
      data,
      oldOffset +
        RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET,
    ),
    newCumulativeToken0PriceX32: readU128(
      data,
      latestOffset +
        RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET,
    ),
    oldCumulativeToken1PriceX32: readU128(
      data,
      oldOffset +
        RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET,
    ),
    newCumulativeToken1PriceX32: readU128(
      data,
      latestOffset +
        RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET,
    ),
  };
}

/** Program-parity native-history bracket: minimum final-radius start in raw [134, 1800] s, sound in-place envelope, outward rounding. */
export function extractRaydiumCpmmNativeBoundedSample(params: {
  observationState: Uint8Array; expectedPoolState?: Uint8Array; useToken0Price: boolean;
  numeratorScale: bigint; denominatorScale: bigint; spotPriceX64: bigint; currentTimestamp: bigint;
}): RaydiumCpmmNativeBoundedSample {
  const data = params.observationState;
  if (data.length !== RAYDIUM_CPMM_OBSERVATION_STATE_LEN ||
      !eqBytes(data.subarray(0, RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR.length), RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR) ||
      data[RAYDIUM_CPMM_OBSERVATION_STATE_INITIALIZED_OFFSET] === 0 ||
      (params.expectedPoolState && !eqBytes(data.subarray(RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET,
        RAYDIUM_CPMM_OBSERVATION_STATE_POOL_ID_OFFSET + 32), params.expectedPoolState))) {
    throw new Error("InvalidRaydiumCpmmObservationState");
  }
  const now = params.currentTimestamp;
  if (now < 0n) throw new Error("InvalidStatus");
  const cumulativeOffset = params.useToken0Price ? RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET
    : RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET;
  const latestIndex = readU16(data, RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET);
  const latestOffset = raydiumCpmmObservationOffset(latestIndex);
  const lastUpdate = readU64(data, RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET);
  const latestCreated = readU64(data, latestOffset + RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET);
  const timestamps = { latestUnixTs: lastUpdate, olderUnixTs: null, currentUnixTs: now };
  if (latestCreated === 0n || latestCreated > lastUpdate || lastUpdate > now || lastUpdate - latestCreated >= 15n) {
    throw new Error("InvalidTwapState");
  }
  if (now - lastUpdate > 60n) {
    throw new MimirNativeTwapUnavailableError("raydium-cpmm", "stale-oracle", timestamps, "StaleSourceActivity");
  }
  let previousTimestamp = 0n;
  const candidates: { offset: number; timestamp: bigint }[] = [];
  for (let step = 1; step <= RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT; step++) {
    const index = (latestIndex + step) % RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT;
    const offset = raydiumCpmmObservationOffset(index);
    const timestamp = readU64(data, offset + RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET);
    if (timestamp === 0n) {
      if (previousTimestamp !== 0n || data.subarray(offset, offset + RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN).some(Boolean)) {
        throw new Error("InvalidTwapState");
      }
      continue;
    }
    if (timestamp <= previousTimestamp || timestamp > lastUpdate) throw new Error("InvalidTwapState");
    const span = lastUpdate - timestamp;
    if (index !== latestIndex && span >= RAYDIUM_CPMM_NATIVE_TWAP_MIN_ENTRY_SPAN_SECS && span <= RAYDIUM_CPMM_NATIVE_TWAP_MAX_ENTRY_SPAN_SECS) {
      candidates.push({ offset, timestamp });
    }
    previousTimestamp = timestamp;
  }
  if (candidates.length === 0) {
    throw new MimirNativeTwapUnavailableError("raydium-cpmm", "history-too-short", timestamps, "InvalidTwapState");
  }
  if (params.spotPriceX64 <= 0n) throw new Error("InvalidTwapState");
  const mask = (1n << 128n) - 1n, spot = params.spotPriceX64;
  const endCumulativeX32 = readU128(data, latestOffset + cumulativeOffset);
  let best: (RaydiumCpmmNativeBoundedSample & { radius: bigint; half: bigint }) | null = null;
  for (const { offset, timestamp } of candidates) {
    const startCumulativeX32 = readU128(data, offset + cumulativeOffset);
    const delta = (endCumulativeX32 - startCumulativeX32) & mask;
    if (delta === 0n) throw new Error("InvalidTwapState");
    const span = lastUpdate - timestamp, minSpan = span - RAYDIUM_CPMM_OBSERVATION_MAX_IN_PLACE_SECS;
    if (delta + minSpan > mask) throw new Error("ArithmeticOverflow");
    const lowerX64 = ratioToX64(delta, params.numeratorScale, span << 32n, params.denominatorScale);
    const upperFloor = ratioToX64(delta + minSpan, params.numeratorScale, minSpan << 32n, params.denominatorScale);
    const upperX64 = upperFloor * (minSpan << 32n) * params.denominatorScale === (delta + minSpan) * params.numeratorScale << 64n
      ? upperFloor : upperFloor + 1n;
    if (upperX64 > mask) throw new Error("ArithmeticOverflow");
    if (lowerX64 === 0n || upperX64 < lowerX64) throw new Error("InvalidTwapState");
    const centerX64 = lowerX64 + (upperX64 - lowerX64) / 2n;
    const half = upperX64 - centerX64 > centerX64 - lowerX64 ? upperX64 - centerX64 : centerX64 - lowerX64;
    const gap = spot > centerX64 ? spot - centerX64 : centerX64 - spot;
    const radius = gap > half ? gap : half;
    if (best !== null) {
      const score = radius * best.centerX64 - best.radius * centerX64;
      if (score > 0n || (score === 0n && half * best.centerX64 > best.half * centerX64)) continue;
    }
    best = { startTimestamp: timestamp, effectiveStartTimestamp: timestamp + RAYDIUM_CPMM_OBSERVATION_MAX_IN_PLACE_SECS,
      endTimestamp: lastUpdate, startCumulativeX32, endCumulativeX32, lowerX64, upperX64, centerX64, radius, half };
  }
  const { radius: _radius, half: _half, ...sample } = best!;
  return { ...sample, finalLowerX64: sample.lowerX64 < spot ? sample.lowerX64 : spot,
    finalUpperX64: sample.upperX64 > spot ? sample.upperX64 : spot };
}

/** Scale pair for the bounded extractor, mirroring the program's direction/decimal normalization. */
export function raydiumCpmmNativeBoundedScales(feed: FeedConfigHeader, direction: number): { numeratorScale: bigint; denominatorScale: bigint } {
  const base = pow10U128(feed.baseDecimals), quote = pow10U128(feed.quoteDecimals);
  if (direction === SourceDirection.QuotePerBase) return { numeratorScale: base, denominatorScale: quote };
  if (direction === SourceDirection.BasePerQuote) return { numeratorScale: quote, denominatorScale: base };
  throw new Error("InvalidSourceConfig");
}

export function raydiumCpmmObservationOffset(index: number): number {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT
  ) {
    throw new Error("InvalidRaydiumCpmmObservationState");
  }
  return (
    RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATIONS_OFFSET +
    index * RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_LEN
  );
}

export function computeRaydiumCpmmNativeTwapPriceX64(params: {
  poolStateData: Uint8Array;
  sourceConfig: SourceConfigHeader;
  feedConfig: FeedConfigHeader;
  sample: RaydiumCpmmNativeTwapObservationSample;
}): bigint {
  const token0IsBase = raydiumCpmmPoolToken0IsBase(
    params.poolStateData,
    params.sourceConfig,
    params.feedConfig,
  );
  assertRaydiumCpmmNativeTwapSampleMatchesPool(
    params.poolStateData,
    params.sample,
  );
  return normalizedCpmmNativeTwapPriceX64({
    token0IsBase,
    direction: params.sourceConfig.direction,
    baseDecimals: params.feedConfig.baseDecimals,
    quoteDecimals: params.feedConfig.quoteDecimals,
    oldTimestamp: params.sample.oldTimestamp,
    newTimestamp: params.sample.newTimestamp,
    oldCumulativeToken0PriceX32: params.sample.oldCumulativeToken0PriceX32,
    newCumulativeToken0PriceX32: params.sample.newCumulativeToken0PriceX32,
    oldCumulativeToken1PriceX32: params.sample.oldCumulativeToken1PriceX32,
    newCumulativeToken1PriceX32: params.sample.newCumulativeToken1PriceX32,
  });
}

export function assertRaydiumCpmmNativeTwapSampleMatchesPool(
  poolStateData: Uint8Array,
  sample: RaydiumCpmmNativeTwapObservationSample,
): void {
  const data = new Uint8Array(poolStateData.buffer, poolStateData.byteOffset, poolStateData.byteLength);
  if (data.length < RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET + 32) {
    throw new Error("InvalidRaydiumCpmmPoolState");
  }
  const observationKey = bytes32(data, RAYDIUM_CPMM_POOL_OBSERVATION_KEY_OFFSET);
  if (!eqBytes(sample.observationState, observationKey)) {
    throw new Error("InvalidRaydiumCpmmObservationState");
  }
}

export interface RaydiumClmmNativeTwapObservation {
  readonly index: number;
  readonly timestamp: bigint;
  readonly cumulativeTick: bigint;
}

export interface RaydiumClmmNativeTwapObservationState {
  readonly initialized: boolean;
  readonly observationIndex: number;
  /** Real observations in canonical newest-to-oldest ring order. */
  readonly observations: readonly RaydiumClmmNativeTwapObservation[];
}

export interface RaydiumClmmNativeTwapObservationSample {
  readonly oldTimestamp: bigint;
  readonly oldCumulativeTick: bigint;
  readonly latestIndex: number;
  readonly latestTimestamp: bigint;
  readonly latestCumulativeTick: bigint;
  readonly currentTick: number;
  readonly nowTimestamp: bigint;
  readonly derivedBranch: 0 | 1;
  readonly endTimestamp: bigint;
  readonly endCumulativeTick: bigint;
  readonly delta: bigint;
  readonly span: bigint;
}

/** Reconstruct the unchanged native hash opening at the authenticated execution/publication Clock. */
export function deriveMimirMixedClmmSample(proof: Extract<MimirMixedBoundedProofV1, { kind: 1 }>,
  nowTimestamp: bigint): RaydiumClmmNativeTwapObservationSample {
  assertRaydiumClmmTick(proof.currentTick);
  const age = nowTimestamp - proof.latestTimestamp;
  if (nowTimestamp < 0n || nowTimestamp > U32_MAX || age < 0n) throw new Error("InvalidRaydiumClmmClock");
  const derivedBranch = age >= RAYDIUM_CLMM_NATIVE_TWAP_MIN_WRITE_GAP_SECS ? 1 : 0;
  const increment = BigInt(proof.currentTick) * age;
  if (increment < I64_MIN || increment > I64_MAX) throw new Error("InvalidRaydiumClmmFingerprintInput");
  const endTimestamp = derivedBranch ? nowTimestamp : proof.latestTimestamp;
  const endCumulativeTick = derivedBranch ? BigInt.asIntN(64, proof.latestCumulative + increment) : proof.latestCumulative;
  return { oldTimestamp: proof.oldTimestamp, oldCumulativeTick: proof.oldCumulative, latestIndex: proof.latestIndex,
    latestTimestamp: proof.latestTimestamp, latestCumulativeTick: proof.latestCumulative, currentTick: proof.currentTick,
    nowTimestamp, derivedBranch, endTimestamp, endCumulativeTick,
    delta: raydiumClmmWrappedI64Difference(endCumulativeTick, proof.oldCumulative), span: endTimestamp - proof.oldTimestamp };
}

export function raydiumClmmSelectionExpiresAtUnixTs(state: RaydiumClmmNativeTwapObservationState,
  sample: RaydiumClmmNativeTwapObservationSample): bigint | null {
  const index = state.observations.findIndex(row => row.timestamp === sample.oldTimestamp && row.cumulativeTick === sample.oldCumulativeTick);
  if (index < 0) throw new Error("InvalidRaydiumClmmFingerprintInput");
  if (index === 0) return null;
  const branch = sample.latestTimestamp + RAYDIUM_CLMM_NATIVE_TWAP_MIN_WRITE_GAP_SECS;
  const selection = state.observations[index - 1]!.timestamp + RAYDIUM_CLMM_NATIVE_TWAP_SELECTION_LOOKBACK_SECS;
  return branch > selection ? branch : selection;
}

function raydiumClmmWrappedI64Difference(left: bigint, right: bigint): bigint {
  const wrapped = (left - right) & U64_MAX;
  return wrapped >= (1n << 63n) ? wrapped - I64_MODULUS : wrapped;
}

function absBigInt(value: bigint): bigint { return value < 0n ? -value : value; }

function assertRaydiumClmmTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < -RAYDIUM_CLMM_MAX_TICK || tick > RAYDIUM_CLMM_MAX_TICK) {
    throw new Error("InvalidRaydiumClmmTick");
  }
}

export function readRaydiumClmmPoolCurrentTick(poolStateData: Uint8Array): number {
  const data = new Uint8Array(poolStateData.buffer, poolStateData.byteOffset, poolStateData.byteLength);
  if (data.length !== 1_544 || !eqBytes(data.subarray(0, 8), RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR)) {
    throw new Error("InvalidRaydiumClmmPoolState");
  }
  const currentTick = view(data).getInt32(RAYDIUM_CLMM_POOL_CURRENT_TICK_OFFSET, true);
  assertRaydiumClmmTick(currentTick);
  return currentTick;
}

/** Parse and validate Raydium's real observation ring without requiring a mature window. */
export function parseRaydiumClmmNativeTwapObservationState(params: {
  observationState: Uint8Array;
  expectedPoolState: Uint8Array;
  currentTimestamp: bigint;
}): RaydiumClmmNativeTwapObservationState {
  const data = new Uint8Array(params.observationState.buffer, params.observationState.byteOffset, params.observationState.byteLength);
  if (data.length !== RAYDIUM_CLMM_OBSERVATION_STATE_LEN || params.expectedPoolState.length !== 32 ||
      typeof params.currentTimestamp !== "bigint" || params.currentTimestamp < 0n || params.currentTimestamp > U32_MAX ||
      !eqBytes(data.subarray(0, 8), RAYDIUM_CLMM_OBSERVATION_DISCRIMINATOR) || data[8]! > 1 ||
      !eqBytes(data.subarray(RAYDIUM_CLMM_OBSERVATION_POOL_OFFSET, RAYDIUM_CLMM_OBSERVATION_POOL_OFFSET + 32), params.expectedPoolState)) {
    throw new Error("InvalidRaydiumClmmObservationState");
  }
  const observationIndex = readU16(data, RAYDIUM_CLMM_OBSERVATION_INDEX_OFFSET);
  if (observationIndex >= RAYDIUM_CLMM_OBSERVATION_COUNT) throw new Error("InvalidRaydiumClmmObservationState");
  const initialized = data[RAYDIUM_CLMM_OBSERVATION_INITIALIZED_OFFSET] === 1;
  const dataView = view(data);
  const entry = (index: number): RaydiumClmmNativeTwapObservation => {
    const offset = RAYDIUM_CLMM_OBSERVATIONS_OFFSET + index * RAYDIUM_CLMM_OBSERVATION_STRIDE;
    return { index, timestamp: BigInt(dataView.getUint32(offset, true)), cumulativeTick: dataView.getBigInt64(offset + 4, true) };
  };
  if (!initialized) {
    for (let index = 0; index < RAYDIUM_CLMM_OBSERVATION_COUNT; index += 1) {
      const row = entry(index);
      if (row.timestamp !== 0n || row.cumulativeTick !== 0n) throw new Error("InvalidRaydiumClmmObservationState");
    }
    return { initialized, observationIndex, observations: [] };
  }
  const observations: RaydiumClmmNativeTwapObservation[] = [];
  let newer: RaydiumClmmNativeTwapObservation | undefined;
  let reachedInitializationBoundary = false;
  for (let distance = 0; distance < RAYDIUM_CLMM_OBSERVATION_COUNT; distance += 1) {
    const index = (observationIndex - distance + RAYDIUM_CLMM_OBSERVATION_COUNT) % RAYDIUM_CLMM_OBSERVATION_COUNT;
    const row = entry(index);
    if (reachedInitializationBoundary) {
      if (row.timestamp !== 0n || row.cumulativeTick !== 0n) throw new Error("InvalidRaydiumClmmObservationState");
      continue;
    }
    // Index zero is always the real initialization anchor, even when its Unix time is zero.
    if (row.timestamp === 0n && index !== 0) {
      if (row.cumulativeTick !== 0n) throw new Error("InvalidRaydiumClmmObservationState");
      reachedInitializationBoundary = true;
      continue;
    }
    if (row.timestamp > params.currentTimestamp || (row.timestamp === 0n && row.cumulativeTick !== 0n)) {
      throw new Error("InvalidRaydiumClmmObservationState");
    }
    if (newer) {
      const elapsed = newer.timestamp - row.timestamp;
      if (elapsed < RAYDIUM_CLMM_NATIVE_TWAP_MIN_WRITE_GAP_SECS ||
          absBigInt(raydiumClmmWrappedI64Difference(newer.cumulativeTick, row.cumulativeTick)) >
            BigInt(RAYDIUM_CLMM_MAX_TICK) * elapsed) {
        throw new Error("InvalidRaydiumClmmObservationState");
      }
    }
    observations.push(row);
    newer = row;
  }
  if (observations.length === 0 || observations[0]!.index !== observationIndex) {
    throw new Error("InvalidRaydiumClmmObservationState");
  }
  return { initialized, observationIndex, observations };
}

/** Returns null only for a structurally valid ring that has not retained a 195-second real span. */
export function selectRaydiumClmmNativeTwapObservationSample(params: {
  state: RaydiumClmmNativeTwapObservationState;
  currentTick: number;
  nowTimestamp: bigint;
}): RaydiumClmmNativeTwapObservationSample | null {
  assertRaydiumClmmTick(params.currentTick);
  if (typeof params.nowTimestamp !== "bigint" || params.nowTimestamp < 0n || params.nowTimestamp > U32_MAX) {
    throw new Error("InvalidRaydiumClmmClock");
  }
  const latest = params.state.observations[0];
  if (!params.state.initialized || !latest) return null;
  const age = params.nowTimestamp - latest.timestamp;
  if (age < 0n) throw new Error("InvalidRaydiumClmmClock");
  const derivedBranch: 0 | 1 = age >= RAYDIUM_CLMM_NATIVE_TWAP_MIN_WRITE_GAP_SECS ? 1 : 0;
  if (derivedBranch === 0 && age > RAYDIUM_CLMM_NATIVE_TWAP_MAX_AGE_SECS) return null;
  const endTimestamp = derivedBranch === 1 ? params.nowTimestamp : latest.timestamp;
  const endCumulativeTick = derivedBranch === 1
    ? BigInt.asIntN(64, latest.cumulativeTick + BigInt(params.currentTick) * age)
    : latest.cumulativeTick;
  const targetTimestamp = endTimestamp - RAYDIUM_CLMM_NATIVE_TWAP_SELECTION_LOOKBACK_SECS;
  const old = params.state.observations.find((row) => row.timestamp <= targetTimestamp);
  if (!old) return null;
  const span = endTimestamp - old.timestamp;
  if (span < RAYDIUM_CLMM_NATIVE_TWAP_MIN_WINDOW_SECS || span > U32_MAX) return null;
  const delta = raydiumClmmWrappedI64Difference(endCumulativeTick, old.cumulativeTick);
  if (absBigInt(delta) > BigInt(RAYDIUM_CLMM_MAX_TICK) * span) throw new Error("InvalidRaydiumClmmObservationState");
  return { oldTimestamp: old.timestamp, oldCumulativeTick: old.cumulativeTick, latestIndex: params.state.observationIndex,
    latestTimestamp: latest.timestamp, latestCumulativeTick: latest.cumulativeTick, currentTick: params.currentTick,
    nowTimestamp: params.nowTimestamp, derivedBranch, endTimestamp, endCumulativeTick, delta, span };
}

export function extractRaydiumClmmNativeTwapObservationSample(params: {
  observationState: Uint8Array;
  expectedPoolState: Uint8Array;
  currentTick: number;
  nowTimestamp: bigint;
}): RaydiumClmmNativeTwapObservationSample {
  const state = parseRaydiumClmmNativeTwapObservationState({ ...params, currentTimestamp: params.nowTimestamp });
  const sample = selectRaydiumClmmNativeTwapObservationSample({ state, currentTick: params.currentTick, nowTimestamp: params.nowTimestamp });
  if (!sample) {
    throw new MimirNativeTwapUnavailableError("raydium-clmm", "history-too-short", {
      latestUnixTs: state.observations[0]?.timestamp ?? null, olderUnixTs: null, currentUnixTs: params.nowTimestamp,
    }, "InvalidRaydiumClmmTwapState");
  }
  return sample;
}

const MAX_U128 = (1n << 128n) - 1n;
const MAX_U256 = (1n << 256n) - 1n;

function token2022Q64Multiplier(bits: bigint): bigint {
  if ((bits >> 63n) !== 0n) throw new Error("InvalidToken2022ScaledUiMultiplier");
  const exponent = Number((bits >> 52n) & 0x7ffn);
  if (exponent === 0 || exponent === 0x7ff) throw new Error("InvalidToken2022ScaledUiMultiplier");
  const significand = (1n << 52n) | (bits & ((1n << 52n) - 1n));
  const shift = exponent - 1023 - 52 + 64;
  let q64: bigint;
  if (shift >= 0) q64 = significand << BigInt(shift);
  else {
    const divisor = 1n << BigInt(-shift);
    const quotient = significand / divisor, remainder = significand % divisor;
    const half = divisor >> 1n;
    q64 = quotient + (remainder > half || (remainder === half && (quotient & 1n) !== 0n) ? 1n : 0n);
  }
  if (q64 < (1n << 32n) || q64 > (1n << 96n)) throw new Error("InvalidToken2022ScaledUiMultiplier");
  return q64;
}

function token2022ScaledUiMultiplierQ64(data: Uint8Array, nowTimestamp: bigint): bigint {
  if (data.length === 82) return Q64;
  for (let offset = 166; offset < data.length;) {
    const type = readU16(data, offset), length = readU16(data, offset + 2), payload = offset + 4;
    if (payload + length > data.length) throw new Error("InvalidToken2022ScaledUiMultiplier");
    if (type === 25) {
      if (length !== 56) throw new Error("InvalidToken2022ScaledUiMultiplier");
      const timestamp = view(data).getBigInt64(payload + 40, true);
      return token2022Q64Multiplier(readU64(data, payload + (nowTimestamp >= timestamp ? 48 : 32)));
    }
    offset = payload + length;
  }
  return Q64;
}

function token2022EconomicPriceX64(rawPriceX64: bigint, selectedBase: boolean, multiplierQ64: bigint): bigint {
  const numeratorMultiplier = selectedBase ? Q64 : multiplierQ64;
  const denominator = selectedBase ? multiplierQ64 : Q64;
  const product = rawPriceX64 * numeratorMultiplier;
  if (rawPriceX64 < 0n || rawPriceX64 > MAX_U128 || product > MAX_U256 || denominator === 0n) {
    throw new Error("InvalidToken2022EconomicPrice");
  }
  let quotient = product / denominator;
  const remainder = product % denominator, half = denominator / 2n;
  if (remainder > half || (remainder === half && denominator % 2n === 0n && (quotient & 1n) !== 0n)) quotient += 1n;
  if (quotient > MAX_U128 || (rawPriceX64 !== 0n && quotient === 0n)) throw new Error("InvalidToken2022EconomicPrice");
  return quotient;
}

/** Native mean published against live economic spot: `envelope` is set only on the former >50 bps refusal branch. */
export interface MimirNativeTwapQuality {
  readonly priceX64: bigint; readonly confidenceBps: number; readonly spotX64: bigint;
  readonly envelope: MimirNativeLagEnvelope | null;
}
export interface MimirNativeLagEnvelope {
  readonly spotX64: bigint; readonly confidenceBps: number; readonly lowerX64: bigint; readonly upperX64: bigint;
}

/** Program `native_lag_envelope`: null keeps the healthy record (gap <= 50 bps or spot inside the base bounds). */
export function mimirNativeLagEnvelope(meanX64: bigint, spotX64: bigint, baseConfidenceBps: number,
  maxConfidenceBps: number): MimirNativeLagEnvelope | null {
  if (meanX64 <= 0n || spotX64 <= 0n || meanX64 > MAX_U128 || spotX64 > MAX_U128) throw new Error("InvalidTwapState");
  if (absBigInt(spotX64 - meanX64) * 10_000n / meanX64 <= 50n) return null;
  const delta = (meanX64 * BigInt(baseConfidenceBps) + 9_999n) / 10_000n;
  if (baseConfidenceBps < 0 || baseConfidenceBps > 10_000 || meanX64 <= delta || meanX64 + delta > MAX_U128) {
    throw new Error("DispersionTooWide");
  }
  const lower0 = meanX64 - delta, upper0 = meanX64 + delta;
  if (lower0 <= spotX64 && spotX64 <= upper0) return null;
  const lowerX64 = spotX64 < lower0 ? spotX64 : lower0, upperX64 = spotX64 > upper0 ? spotX64 : upper0;
  const width = meanX64 - lowerX64 > upperX64 - meanX64 ? meanX64 - lowerX64 : upperX64 - meanX64;
  const confidenceBps = (width * 10_000n + meanX64 - 1n) / meanX64;
  if (confidenceBps > 0xffffn || confidenceBps > BigInt(maxConfidenceBps)) throw new Error("DispersionTooWide");
  return { spotX64, confidenceBps: Number(confidenceBps), lowerX64, upperX64 };
}

/** Envelope rings only: `sha256(fp || "MIMIR_NATIVE_LAG_ENVELOPE_V1" || S u128 LE || c u16 LE)`, before any Token-2022 wrap. */
export function mimirNativeLagEnvelopeFingerprint(fingerprint: Uint8Array,
  envelope?: Pick<MimirNativeLagEnvelope, "spotX64" | "confidenceBps"> | null): Uint8Array {
  if (!envelope) return fingerprint;
  const tail = new Uint8Array(18), tailView = new DataView(tail.buffer);
  tailView.setBigUint64(0, envelope.spotX64 & U64_MAX, true); tailView.setBigUint64(8, envelope.spotX64 >> 64n, true);
  tailView.setUint16(16, envelope.confidenceBps, true);
  return sha256(concatBytes(fingerprint, utf8("MIMIR_NATIVE_LAG_ENVELOPE_V1"), tail));
}

function nativeTwapQuality(priceX64: bigint, spotX64: bigint, baseConfidenceBps: number, maxConfidenceBps: number,
  refusal: string): MimirNativeTwapQuality {
  let envelope: MimirNativeLagEnvelope | null;
  try { envelope = mimirNativeLagEnvelope(priceX64, spotX64, baseConfidenceBps, maxConfidenceBps); }
  catch { throw new Error(refusal); }
  return { priceX64, confidenceBps: envelope?.confidenceBps ?? baseConfidenceBps, spotX64, envelope };
}

export function computeRaydiumClmmNativeTwapPriceX64(params: Parameters<typeof computeRaydiumClmmNativeTwapQuality>[0]): bigint {
  return computeRaydiumClmmNativeTwapQuality(params).priceX64;
}

export function computeRaydiumClmmNativeTwapQuality(params: {
  poolStateData: Uint8Array;
  sourceConfig: SourceConfigHeader;
  feedConfig: FeedConfigHeader;
  sample: RaydiumClmmNativeTwapObservationSample;
  token2022MintAccount?: Token2022ClmmAccount;
  token2022SelectedVaultAccount?: Token2022ClmmAccount;
  nowTimestamp?: bigint;
  cluster?: MimirGenerationCluster;
}): MimirNativeTwapQuality {
  const data = new Uint8Array(params.poolStateData.buffer, params.poolStateData.byteOffset, params.poolStateData.byteLength);
  const { sourceConfig: source, feedConfig: feed, sample } = params;
  if (data.length !== 1_544 || !eqBytes(data.subarray(0, 8), RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR) ||
      source.adapterType !== SourceAdapterType.RaydiumClmm || !Number.isInteger(source.adapterVersion) ||
      source.adapterVersion < 0 || source.adapterVersion > 1 || !eqBytes(source.programId, addressBytes(params.cluster === "devnet" ? RAYDIUM_CLMM_DEVNET_PROGRAM : RAYDIUM_CLMM_PROGRAM)) ||
      source.direction < 0 || source.direction > 1 || !eqBytes(feed.feedId, source.feedId) ||
      !eqBytes(feed.baseMint, source.baseMint) || !eqBytes(feed.quoteMint, source.quoteMint)) {
    throw new Error("InvalidRaydiumClmmSourceConfig");
  }
  const mint0 = bytes32(data, RAYDIUM_CLMM_POOL_MINT0_OFFSET), mint1 = bytes32(data, RAYDIUM_CLMM_POOL_MINT1_OFFSET);
  const vault0 = bytes32(data, RAYDIUM_CLMM_POOL_VAULT0_OFFSET), vault1 = bytes32(data, RAYDIUM_CLMM_POOL_VAULT1_OFFSET);
  const token0IsBase = eqBytes(mint0, source.baseMint) && eqBytes(mint1, source.quoteMint) &&
    eqBytes(vault0, source.baseVault) && eqBytes(vault1, source.quoteVault);
  const token1IsBase = eqBytes(mint1, source.baseMint) && eqBytes(mint0, source.quoteMint) &&
    eqBytes(vault1, source.baseVault) && eqBytes(vault0, source.quoteVault);
  if (!token0IsBase && !token1IsBase) throw new Error("InvalidRaydiumClmmSourceConfig");
  const decimals0 = data[RAYDIUM_CLMM_POOL_MINT0_DECIMALS_OFFSET]!;
  const decimals1 = data[RAYDIUM_CLMM_POOL_MINT1_DECIMALS_OFFSET]!;
  if ((token0IsBase && (decimals0 !== feed.baseDecimals || decimals1 !== feed.quoteDecimals)) ||
      (token1IsBase && (decimals1 !== feed.baseDecimals || decimals0 !== feed.quoteDecimals)) ||
      view(data).getInt32(RAYDIUM_CLMM_POOL_CURRENT_TICK_OFFSET, true) !== sample.currentTick) {
    throw new Error("InvalidRaydiumClmmSourceConfig");
  }
  const rawPrice = meteoraDlmmPriceFromCumulativeBinX64(sample.delta, sample.span, 1);
  const direct = (token0IsBase && source.direction === SourceDirection.QuotePerBase) ||
    (token1IsBase && source.direction === SourceDirection.BasePerQuote);
  const rawNativePrice = direct
    ? normalizedDirectQ64PriceX64(rawPrice, feed.baseDecimals, feed.quoteDecimals)
    : normalizedInverseQ64PriceX64(rawPrice, feed.baseDecimals, feed.quoteDecimals);
  const rawSpotPrice = squareQ64ToX64(readU128(data, 253));
  if (rawSpotPrice === 0n) throw new Error("InvalidRaydiumClmmSourceConfig");
  const normalizedSpotPrice = direct
    ? normalizedDirectQ64PriceX64(rawSpotPrice, feed.baseDecimals, feed.quoteDecimals)
    : normalizedInverseQ64PriceX64(rawSpotPrice, feed.baseDecimals, feed.quoteDecimals);
  let nativePrice = rawNativePrice, spotPrice = normalizedSpotPrice;
  if (source.adapterVersion === 1) {
    const mint = params.token2022MintAccount, vault = params.token2022SelectedVaultAccount;
    if (!mint || !vault || typeof params.nowTimestamp !== "bigint" || params.nowTimestamp < 0n ||
        (mint.address !== bytesAddress(source.baseMint) && mint.address !== bytesAddress(source.quoteMint))) {
      throw new Error("InvalidRaydiumClmmToken2022Binding");
    }
    const isSelectedBase = mint.address === bytesAddress(source.baseMint);
    const selectedVault = isSelectedBase ? source.baseVault : source.quoteVault;
    const selectedDecimals = isSelectedBase ? feed.baseDecimals : feed.quoteDecimals;
    if (!eqBytes(source.tokenProgram, addressBytes(mint.owner)) || !eqBytes(source.tokenProgram, addressBytes(vault.owner))) {
      throw new Error("InvalidRaydiumClmmToken2022Binding");
    }
    requireUnconditionedToken2022(mint, vault, bytesAddress(selectedVault), selectedDecimals, bytesAddress(source.vaultAuthority), params.nowTimestamp);
    const multiplier = token2022ScaledUiMultiplierQ64(mint.data, params.nowTimestamp);
    nativePrice = token2022EconomicPriceX64(rawNativePrice, isSelectedBase, multiplier);
    spotPrice = token2022EconomicPriceX64(normalizedSpotPrice, isSelectedBase, multiplier);
  }
  if (nativePrice === 0n || spotPrice === 0n) throw new Error("RaydiumClmmNativeSpotDeviationTooWide");
  return nativeTwapQuality(nativePrice, spotPrice, 5, feed.maxConfidenceBps, "RaydiumClmmNativeSpotDeviationTooWide");
}

export function computeRaydiumClmmNativeTwapObservationFingerprint(params: {
  observationState: Uint8Array;
  sourceConfig: Uint8Array;
  pool: Uint8Array;
  selectedPlanHash: Uint8Array;
  sourceConfigRevision: bigint;
  sourceSetRevision: bigint;
  adapterVersion: number;
  sample: RaydiumClmmNativeTwapObservationSample;
  token2022Binding?: { mintAddress: Uint8Array; selectedBase: boolean; selectedMultiplierQ64: bigint };
  lagEnvelope?: Pick<MimirNativeLagEnvelope, "spotX64" | "confidenceBps"> | null;
}): Uint8Array {
  const { sample } = params;
  const addresses = [params.observationState, params.sourceConfig, params.pool, params.selectedPlanHash];
  if (addresses.some((value) => !(value instanceof Uint8Array) || value.length !== 32) ||
      params.sourceConfigRevision <= 0n || params.sourceConfigRevision > U64_MAX ||
      params.sourceSetRevision <= 0n || params.sourceSetRevision > U64_MAX ||
      !Number.isInteger(params.adapterVersion) || (params.adapterVersion !== 0 && params.adapterVersion !== 1) ||
      !Number.isInteger(sample.latestIndex) || sample.latestIndex < 0 || sample.latestIndex >= RAYDIUM_CLMM_OBSERVATION_COUNT ||
      sample.oldTimestamp < 0n || sample.oldTimestamp > U32_MAX || sample.latestTimestamp < sample.oldTimestamp ||
      sample.latestTimestamp > U32_MAX || sample.nowTimestamp < sample.latestTimestamp || sample.nowTimestamp > U32_MAX ||
      sample.endTimestamp < 0n || sample.endTimestamp > U32_MAX ||
      sample.oldCumulativeTick < I64_MIN || sample.oldCumulativeTick > I64_MAX ||
      sample.latestCumulativeTick < I64_MIN || sample.latestCumulativeTick > I64_MAX ||
      sample.endCumulativeTick < I64_MIN || sample.endCumulativeTick > I64_MAX ||
      !Number.isInteger(sample.currentTick) || sample.currentTick < -RAYDIUM_CLMM_MAX_TICK || sample.currentTick > RAYDIUM_CLMM_MAX_TICK ||
      sample.span < RAYDIUM_CLMM_NATIVE_TWAP_MIN_WINDOW_SECS || sample.span > U32_MAX ||
      sample.endTimestamp - sample.oldTimestamp !== sample.span || sample.delta !== raydiumClmmWrappedI64Difference(
        sample.endCumulativeTick, sample.oldCumulativeTick) || sample.delta < I64_MIN || sample.delta > I64_MAX ||
      absBigInt(sample.delta) > BigInt(RAYDIUM_CLMM_MAX_TICK) * sample.span) {
    throw new Error("InvalidRaydiumClmmFingerprintInput");
  }
  if ((sample.derivedBranch === 0 && (sample.nowTimestamp - sample.latestTimestamp >= RAYDIUM_CLMM_NATIVE_TWAP_MIN_WRITE_GAP_SECS ||
        sample.endTimestamp !== sample.latestTimestamp || sample.endCumulativeTick !== sample.latestCumulativeTick)) ||
      (sample.derivedBranch === 1 && (sample.nowTimestamp - sample.latestTimestamp < RAYDIUM_CLMM_NATIVE_TWAP_MIN_WRITE_GAP_SECS ||
        sample.endTimestamp !== sample.nowTimestamp || sample.endCumulativeTick !== BigInt.asIntN(64,
          sample.latestCumulativeTick + BigInt(sample.currentTick) * (sample.nowTimestamp - sample.latestTimestamp)))) ||
      (sample.derivedBranch !== 0 && sample.derivedBranch !== 1)) {
    throw new Error("InvalidRaydiumClmmFingerprintInput");
  }
  const values = new Uint8Array(97); const data = new DataView(values.buffer); let offset = 0;
  data.setBigUint64(offset, params.sourceConfigRevision, true); offset += 8;
  data.setBigUint64(offset, params.sourceSetRevision, true); offset += 8;
  data.setUint16(offset, params.adapterVersion, true); offset += 2;
  data.setUint16(offset, sample.latestIndex, true); offset += 2;
  data.setBigUint64(offset, sample.oldTimestamp, true); offset += 8;
  data.setBigInt64(offset, sample.oldCumulativeTick, true); offset += 8;
  data.setBigUint64(offset, sample.latestTimestamp, true); offset += 8;
  data.setBigInt64(offset, sample.latestCumulativeTick, true); offset += 8;
  data.setInt32(offset, sample.currentTick, true); offset += 4;
  data.setBigUint64(offset, sample.nowTimestamp, true); offset += 8;
  data.setUint8(offset, sample.derivedBranch); offset += 1;
  data.setBigUint64(offset, sample.endTimestamp, true); offset += 8;
  data.setBigInt64(offset, sample.endCumulativeTick, true); offset += 8;
  data.setBigInt64(offset, sample.delta, true); offset += 8;
  data.setBigUint64(offset, sample.span, true);
  const fingerprint = mimirNativeLagEnvelopeFingerprint(sha256(concatBytes(utf8("MIMIR_RAYDIUM_CLMM_NATIVE_Q64_STEP1_V1"),
    ...addresses, values)), params.lagEnvelope);
  const binding = params.token2022Binding;
  if (params.adapterVersion === 0 && binding === undefined) return fingerprint;
  if (params.adapterVersion !== 1 || !binding || !(binding.mintAddress instanceof Uint8Array) || binding.mintAddress.length !== 32 ||
      typeof binding.selectedBase !== "boolean" || typeof binding.selectedMultiplierQ64 !== "bigint" ||
      binding.selectedMultiplierQ64 < (1n << 32n) || binding.selectedMultiplierQ64 > (1n << 96n)) {
    throw new Error("InvalidRaydiumClmmFingerprintInput");
  }
  const multiplier = new Uint8Array(16), multiplierView = new DataView(multiplier.buffer);
  multiplierView.setBigUint64(0, binding.selectedMultiplierQ64 & U64_MAX, true);
  multiplierView.setBigUint64(8, binding.selectedMultiplierQ64 >> 64n, true);
  return sha256(concatBytes(utf8("MIMIR_RAYDIUM_CLMM_NATIVE_TOKEN2022_ECONOMIC_V1"), fingerprint,
    binding.mintAddress, Uint8Array.of(Number(binding.selectedBase)), multiplier));
}
