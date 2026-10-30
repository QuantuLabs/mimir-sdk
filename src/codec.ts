import { Buffer } from "buffer";
import { decodeFeedSnapshotHeader, decodeMimirBrowserCompositePublication, decodeMimirBrowserCompositeSnapshotHeader, validateEnum, decodeSourcingPlanHeader, raydiumCpmmPoolToken0IsBaseForFeed, raydiumCpmmObservationOffset, assertRaydiumCpmmNativeTwapSampleMatchesPool } from "./internal/nativeMonoRefreshCore.js";
export { decodeFeedCollateralLockHeader, decodeFeedSnapshotHeader, decodeFeedTwapStateHeader, decodeLifecycleFeedConfigHeader, decodeFeedConfigHeader, decodeOracleRegistryHeader, decodeSourcingPlanHeader, decodeSourceConfigHeader, decodeLifecycleFeedTwapSentinel, decodeLifecycleFeedSnapshotSentinel, readRaydiumCpmmPoolObservationKey, readMeteoraDlmmPoolObservationKey, readRaydiumCpmmPoolAmmConfig, raydiumCpmmPoolToken0IsBaseForFeed, raydiumCpmmPoolToken0IsBase, extractRaydiumCpmmNativeTwapObservationSample, computeRaydiumCpmmNativeTwapPriceX64, extractMeteoraDlmmNativeTwapSample, computeMeteoraDlmmNativeTwapPriceX64, METEORA_DLMM_NATIVE_TWAP_MIN_WINDOW_SECS, METEORA_DLMM_NATIVE_TWAP_MAX_LAST_UPDATE_AGE_SECS, METEORA_DLMM_PROGRAMDATA_ADDRESS, ACCEPTED_METEORA_DLMM_DEPLOYMENT_UNIX } from "./internal/nativeMonoRefreshCore.js";
export type { MeteoraDlmmNativeTwapSample } from "./internal/nativeMonoRefreshCore.js";
export * from "./internal/sampledTemporalCore.js";

/** A typed bounded snapshot is not a scalar TWAP or a preparation authority. */
export function decodeMixedBoundedSnapshotV1(input: Uint8Array) {
  const snapshot = decodeFeedSnapshotHeader(input);
  if (snapshot.snapshotSource !== 5) throw new Error("InvalidMixedBoundedSnapshot");
  return { ...snapshot, snapshotSource: 5 as const };
}
import { decodeMimirBrowserSourceRingV1,
  decodeMimirBrowserDammReserveTemporalModuleV3, decodeMimirBrowserSourceTemporalModuleV1, decodeMimirBrowserCpmmQuietTemporalModuleV2 } from "./internal/nativeMonoRefreshCore.js";
export { SOURCE_RING_DAMM_ONLYB_V1, SOURCE_TEMPORAL_MODULE_V1 } from "./internal/nativeMonoRefreshCore.js";
import { createHash } from "./internal/sha256.js";
import {
  FEED_RESERVATION_HEADER_LEN,
  GOVERNANCE_ACTION_HEADER_LEN,
  GOVERNANCE_POLICY_HEADER_LEN,
  EXECUTABLE_SOURCE_ADAPTER_MASK_V0,
  ADMIN_CONFIG_HEADER_LEN,
  ADMIN_MAX_COMPOSITE_ACTIVATION_FEE_LAMPORTS,
  FEED_FEE_VAULT_HEADER_LEN,
  COMPOSITE_COMPONENT_CONFIG_LEN,
  COMPOSITE_FEED_CONFIG_HEADER_LEN,
  COMPOSITE_FEED_CONFIG_V1_HEADER_LEN,
  MAX_COMPOSITE_COMPONENTS,
  MIN_COMPOSITE_COMPONENTS,
  MAX_SUPPORTED_SOURCE_ADAPTER_VERSION,
  PLAN_ACCOUNTS_BINDING_STATIC_V1,
  PLAN_CANONICAL_RING_VERSION_MERKLE_V1,
  PLAN_HASH_SCHEME_MERKLE_V1,
  PLAN_MEMBERSHIP_LEAF_COUNT_V1,
  REGISTRY_ADAPTER_VERSION_MASK_COUNT,
  MAX_TWAP_AGGREGATION_SOURCES,
  isKnownSourceAdapterType,
  SOURCING_PLAN_HEADER_LEN,
  RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
  RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT,
  RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET,
  RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG,
  VERSION_V0,
  VERSION_V1,
  sourceAdapterSupportsVersion,
} from "./constants.js";
import { freshCanonicalAuthority } from "./internal/canonicalAuthority.js";
import { assertPlainSnapshotSource, verifyFeedConfigForSnapshot, verifySnapshotHeaderPolicy } from "./internal/snapshotPolicyCore.js";
import {
  findCompositeFeedConfigPda,
  findFeedSnapshotPda,
} from "./pda.js";
import { normalizedCpmmNativeTwapPriceX64 } from "./math.js";
import { decodeMimirBetaTicker, MIMIR_BETA_PRIMARY_TICKER_PRESENT } from "./beta/abi.js";
import { PublicKey } from "@solana/web3.js";
import type {
  AdminConfigHeader,
  Bytes32,
  CompositeFeedConfigHeader,
  CompositeSnapshotHeader,
  FeedFeeVaultClaimSummary,
  FeedFeeVaultHeader,
  FeedConfigHeader,
  FeedReservationHeader,
  FeedSnapshotHeader,
  FeedTwapStateHeader,
  LifecycleSourcingPlanHeader,
  GovernanceActionHeader,
  GovernancePolicyHeader,
  OracleRegistryHeader,
  SnapshotPolicy,
  SourceConfigHeader,
  SourceObservationRingHeader,
  SourceObservationRingV1Header,
  SourcingPlanHeader,
  RaydiumCpmmNativeTwapObservationSample,
  ProjectRaydiumCpmmObservationAfterCrankParams,
} from "./types.js";

const {
  AnchorProvider,
  CONFIG_OFFSETS,
  FEED_CONFIG_MAGIC,
  FEED_RESERVATION_MAGIC,
  FEED_SNAPSHOT_MAGIC,
  FeedReservationStatus,
  FeedLifecycleState,
  FEED_TWAP_MAGIC,
  FreshnessProfile,
  GOVERNANCE_ACTION_MAGIC,
  GOVERNANCE_ACTION_OFFSETS,
  GOVERNANCE_POLICY_MAGIC,
  GOVERNANCE_POLICY_OFFSETS,
  GovernanceActionStatus,
  GovernanceActionTargetKind,
  GovernancePolicyStatus,
  ADMIN_CONFIG_MAGIC,
  ADMIN_CONFIG_OFFSETS,
  AdminConfigStatus,
  FEED_FEE_VAULT_MAGIC,
  FEED_FEE_VAULT_OFFSETS,
  FeedFeeVaultStatus,
  COMPOSITE_COMPONENT_OFFSETS,
  COMPOSITE_CONFIG_OFFSETS,
  COMPOSITE_FEED_CONFIG_MAGIC,
  CAP_MODEL_HASH_V2,
  MIMIR_PROGRAM_ID: CANONICAL_MIMIR_PROGRAM_ID,
  ObservationKind,
  OFFSETS,
  ORACLE_REGISTRY_MAGIC,
  PLAN_OFFSETS,
  PlanStatus,
  PlanProfile,
  QuoteStatus,
  REGISTRY_OFFSETS,
  RegistryStatus,
  RESERVATION_OFFSETS,
  RiskTier,
  SOURCE_CONFIG_MAGIC,
  SOURCE_OFFSETS,
  SOURCE_CAP_ENTRY_OFFSETS,
  SOURCE_RING_MAGIC,
  SourceAdapterType,
  SourceDirection,
  SourceStatus,
  SOURCING_PLAN_MAGIC,
  RouteabilityStatus,
  RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR,
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
  RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR,
  SnapshotSource,
  SnapshotStatus,
  SPL_TOKEN_PROGRAM_ID: CANONICAL_SPL_TOKEN_PROGRAM_ID,
  RING_OFFSETS,
  TWAP_OFFSETS,
  TwapStatus,
  VerifyFlags,
} = freshCanonicalAuthority(PublicKey);

const U128_MOD = 1n << 128n;
const RAYDIUM_CPMM_OBSERVATION_UPDATE_DURATION_SECS = 15n;

function bytes32(data: Uint8Array, offset: number): Bytes32 {
  return Uint8Array.from(data.subarray(offset, offset + 32));
}

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function writeU64(data: Buffer, offset: number, value: bigint): void {
  if (value < 0n || value > (1n << 64n) - 1n) {
    throw new RangeError(`u64 value out of range: ${value}`);
  }
  data.writeBigUInt64LE(value, offset);
}

function writeU128Wrapping(data: Buffer, offset: number, value: bigint): void {
  const wrapped = ((value % U128_MOD) + U128_MOD) % U128_MOD;
  data.writeBigUInt64LE(wrapped & ((1n << 64n) - 1n), offset);
  data.writeBigUInt64LE(wrapped >> 64n, offset + 8);
}

function isZeroBytes(value: Uint8Array): boolean {
  for (const byte of value) {
    if (byte !== 0) return false;
  }
  return true;
}

function hashv(items: readonly Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const item of items) hash.update(item);
  return hash.digest();
}

function computeCompositeComponentSetHashForHeader(
  header: Pick<
    CompositeFeedConfigHeader,
    "quoteMint" | "solConversionSourceConfig" | "componentCount" | "components"
  >,
  _programId: PublicKey,
): Buffer {
  const items: Uint8Array[] = [
    Buffer.from("MIMIR_COMPOSITE_COMPONENTS_V1", "ascii"),
    Buffer.from(header.quoteMint),
    Buffer.from([header.componentCount]),
    Buffer.from(header.solConversionSourceConfig),
  ];
  for (let index = 0; index < header.componentCount; index += 1) {
    const component = header.components[index];
    const quantity = Buffer.alloc(16);
    quantity.writeBigUInt64LE(component.quantityX64 & ((1n << 64n) - 1n), 0);
    quantity.writeBigUInt64LE(component.quantityX64 >> 64n, 8);
    items.push(Buffer.from(component.feedId));
    items.push(Buffer.from(component.sourceConfig));
    items.push(quantity);
  }
  return hashv(items);
}

function u64Le(value: bigint): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value);
  return out;
}

function u128Le(value: bigint): Buffer {
  const out = Buffer.alloc(16);
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n), 0);
  out.writeBigUInt64LE(value >> 64n, 8);
  return out;
}

export function computeCompositeComponentSnapshotHash(
  header: Pick<CompositeSnapshotHeader, "componentCount" | "components">,
): Buffer {
  if (
    header.componentCount < MIN_COMPOSITE_COMPONENTS ||
    header.componentCount > MAX_COMPOSITE_COMPONENTS ||
    header.components.length < header.componentCount
  ) {
    throw new Error("InvalidCompositeSnapshot");
  }
  const items: Uint8Array[] = [
    Buffer.from("MIMIR_COMPOSITE_SNAPSHOT_COMPONENTS_V1", "ascii"),
  ];
  for (let index = 0; index < header.componentCount; index += 1) {
    const component = header.components[index];
    items.push(Buffer.from(component.feedId));
    items.push(u64Le(component.snapshotRevision));
    items.push(u64Le(component.snapshotSlot));
    items.push(u128Le(component.priceX64));
    items.push(u128Le(component.contributionX64));
  }
  return hashv(items);
}

function computeCompositeFeedIdForHeader(
  header: Pick<
    CompositeFeedConfigHeader,
    "creator" | "quoteMint" | "priceExponent" | "componentCount" | "componentSetHash"
  >,
): Buffer {
  const priceExponent = Buffer.alloc(4);
  priceExponent.writeInt32LE(header.priceExponent, 0);
  return hashv([
    Buffer.from("MIMIR_COMPOSITE_FEED_ID_V1", "ascii"),
    Buffer.from(header.creator),
    Buffer.from(header.quoteMint),
    priceExponent,
    Buffer.from([header.componentCount]),
    Buffer.from(header.componentSetHash),
  ]);
}


function readU16(data: Buffer, offset: number): number {
  return data.readUInt16LE(offset);
}

function readU32(data: Buffer, offset: number): number {
  return data.readUInt32LE(offset);
}

function readU64(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset);
}

function readU128(data: Buffer, offset: number): bigint {
  return data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << 64n);
}




export function normalizedRegistryAdapterVersionMask(rawMask: number): number {
  return rawMask === 0 ? 1 << VERSION_V0 : rawMask;
}

export function registrySupportsAdapterVersion(
  registry: OracleRegistryHeader,
  adapterType: number,
  adapterVersion: number,
): boolean {
  if (!isKnownSourceAdapterType(adapterType)) throw new Error("InvalidEnum");
  if (
    !Number.isInteger(adapterVersion) ||
    adapterVersion < 0 ||
    adapterVersion > MAX_SUPPORTED_SOURCE_ADAPTER_VERSION ||
    !sourceAdapterSupportsVersion(adapterType, adapterVersion)
  ) return false;
  const rawMask = registry.supportedAdapterVersionMasks[adapterType];
  if (rawMask === undefined) throw new Error("InvalidRegistry");
  if (
    rawMask !== 0 &&
    (rawMask < 0 ||
      (rawMask & ~((1 << VERSION_V1) | (1 << VERSION_V0))) !== 0 ||
      (rawMask & (1 << VERSION_V0)) === 0 ||
      (rawMask & (1 << VERSION_V1)) !== 0 &&
        !sourceAdapterSupportsVersion(adapterType, VERSION_V1))
  ) return false;
  return (normalizedRegistryAdapterVersionMask(rawMask) & (1 << adapterVersion)) !== 0;
}

export function verifyRegistryAdapterVersionPolicy(
  registry: OracleRegistryHeader,
): void {
  if (
    registry.supportedAdapterMask === 0n ||
    (registry.supportedAdapterMask & ~EXECUTABLE_SOURCE_ADAPTER_MASK_V0) !== 0n
  ) {
    throw new Error("InvalidRegistry");
  }

  const supportedVersionBits = (1 << (MAX_SUPPORTED_SOURCE_ADAPTER_VERSION + 1)) - 1;
  for (let adapterType = 0; adapterType < REGISTRY_ADAPTER_VERSION_MASK_COUNT; adapterType += 1) {
    const rawMask = registry.supportedAdapterVersionMasks[adapterType] ?? 0;
    const adapterBit = 1n << BigInt(adapterType);
    if ((registry.supportedAdapterMask & adapterBit) === 0n) {
      if (rawMask !== 0) throw new Error("InvalidRegistry");
      continue;
    }
    if (rawMask !== 0 &&
      ((rawMask & ~supportedVersionBits) !== 0 ||
        (rawMask & (1 << VERSION_V0)) === 0 ||
        ((rawMask & (1 << VERSION_V1)) !== 0 &&
          !sourceAdapterSupportsVersion(adapterType, VERSION_V1)))) {
      throw new Error("InvalidRegistry");
    }
  }
}


export function decodeCompositeFeedConfigHeader(
  input: Uint8Array,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): CompositeFeedConfigHeader {
  const raw = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (raw.length !== COMPOSITE_FEED_CONFIG_V1_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (readU16(raw, COMPOSITE_CONFIG_OFFSETS.version) !== VERSION_V1) {
    throw new Error("UnsupportedVersion");
  }
  if (readU16(raw, COMPOSITE_CONFIG_OFFSETS.headerLen) !== COMPOSITE_FEED_CONFIG_V1_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }
  if (isZeroBytes(raw.subarray(COMPOSITE_FEED_CONFIG_HEADER_LEN))) {
    throw new Error("InvalidCompositeFeed");
  }
  const flags = readU32(raw, COMPOSITE_CONFIG_OFFSETS.flags);
  const tickerBytes = raw.subarray(COMPOSITE_CONFIG_OFFSETS.bump + 1, COMPOSITE_CONFIG_OFFSETS.solConversionSourceConfig);
  let ticker: string | null = null;
  if (flags === MIMIR_BETA_PRIMARY_TICKER_PRESENT) {
    try {
      ticker = decodeMimirBetaTicker(tickerBytes);
    } catch {
      throw new Error("InvalidCompositeFeed");
    }
  } else if (flags !== 0 || !isZeroBytes(tickerBytes)) {
    throw new Error("InvalidCompositeFeed");
  }
  const data = Buffer.from(raw.subarray(0, COMPOSITE_FEED_CONFIG_HEADER_LEN));
  data.writeUInt32LE(0, COMPOSITE_CONFIG_OFFSETS.flags);
  data.fill(0, COMPOSITE_CONFIG_OFFSETS.bump + 1, COMPOSITE_CONFIG_OFFSETS.solConversionSourceConfig);
  data.writeUInt16LE(VERSION_V0, COMPOSITE_CONFIG_OFFSETS.version);
  data.writeUInt16LE(COMPOSITE_FEED_CONFIG_HEADER_LEN, COMPOSITE_CONFIG_OFFSETS.headerLen);
  if (
    !eqBytes(
      data.subarray(
        COMPOSITE_CONFIG_OFFSETS.magic,
        COMPOSITE_CONFIG_OFFSETS.magic + 8,
      ),
      COMPOSITE_FEED_CONFIG_MAGIC,
    )
  ) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, COMPOSITE_CONFIG_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (
    readU16(data, COMPOSITE_CONFIG_OFFSETS.headerLen) !==
    COMPOSITE_FEED_CONFIG_HEADER_LEN
  ) {
    throw new Error("InvalidHeaderLength");
  }
  if (readU32(data, COMPOSITE_CONFIG_OFFSETS.flags) !== 0) {
    throw new Error("InvalidCompositeFeed");
  }

  const componentCount = data[COMPOSITE_CONFIG_OFFSETS.componentCount];
  if (
    componentCount < MIN_COMPOSITE_COMPONENTS ||
    componentCount > MAX_COMPOSITE_COMPONENTS
  ) {
    throw new Error("InvalidCompositeFeed");
  }

  const components = [];
  for (let index = 0; index < componentCount; index += 1) {
    const offset =
      COMPOSITE_CONFIG_OFFSETS.components + index * COMPOSITE_COMPONENT_CONFIG_LEN;
    const feedId = bytes32(data, offset + COMPOSITE_COMPONENT_OFFSETS.feedId);
    const sourceConfig = bytes32(
      data,
      offset + COMPOSITE_COMPONENT_OFFSETS.feedConfig,
    );
    const quantityX64 = readU128(
      data,
      offset + COMPOSITE_COMPONENT_OFFSETS.quantityX64,
    );
    if (isZeroBytes(feedId) || isZeroBytes(sourceConfig) || quantityX64 === 0n) {
      throw new Error("InvalidCompositeFeed");
    }
    for (const prior of components) {
      if (
        eqBytes(prior.feedId, feedId) ||
        eqBytes(prior.sourceConfig, sourceConfig)
      ) {
        throw new Error("InvalidCompositeFeed");
      }
    }
    components.push({ feedId, sourceConfig, quantityX64 });
  }
  for (let index = componentCount; index < MAX_COMPOSITE_COMPONENTS; index += 1) {
    const offset =
      COMPOSITE_CONFIG_OFFSETS.components + index * COMPOSITE_COMPONENT_CONFIG_LEN;
    if (
      !isZeroBytes(
        data.subarray(offset, offset + COMPOSITE_COMPONENT_CONFIG_LEN),
      )
    ) {
      throw new Error("InvalidAccountData");
    }
  }

  const header = {
    compositeFeedId: bytes32(data, COMPOSITE_CONFIG_OFFSETS.feedId),
    creator: bytes32(data, COMPOSITE_CONFIG_OFFSETS.creator),
    quoteMint: bytes32(data, COMPOSITE_CONFIG_OFFSETS.quoteMint),
    solConversionSourceConfig: bytes32(
      data,
      COMPOSITE_CONFIG_OFFSETS.solConversionSourceConfig,
    ),
    priceExponent: data.readInt32LE(COMPOSITE_CONFIG_OFFSETS.priceExponent),
    status: data[COMPOSITE_CONFIG_OFFSETS.status],
    routeabilityCap: data[COMPOSITE_CONFIG_OFFSETS.routeabilityCap],
    riskTier: data[COMPOSITE_CONFIG_OFFSETS.riskTier],
    componentCount,
    maxSnapshotAgeSlots: readU16(
      data,
      COMPOSITE_CONFIG_OFFSETS.maxSnapshotAgeSlots,
    ),
    maxComponentSnapshotAgeSlots: readU16(
      data,
      COMPOSITE_CONFIG_OFFSETS.maxComponentSnapshotAgeSlots,
    ),
    maxComponentConfidenceBps: readU16(
      data,
      COMPOSITE_CONFIG_OFFSETS.maxComponentConfidenceBps,
    ),
    maxComponentDispersionBps: readU16(
      data,
      COMPOSITE_CONFIG_OFFSETS.maxComponentDispersionBps,
    ),
    componentSetHash: bytes32(data, COMPOSITE_CONFIG_OFFSETS.componentSetHash),
    registryEpoch: readU64(data, COMPOSITE_CONFIG_OFFSETS.registryEpoch),
    configRevision: readU64(data, COMPOSITE_CONFIG_OFFSETS.configRevision),
    adminConfigRevisionAtCreation: readU64(
      data,
      COMPOSITE_CONFIG_OFFSETS.adminConfigRevisionAtCreation,
    ),
    bump: data[COMPOSITE_CONFIG_OFFSETS.bump],
    ticker,
    components,
  };

  if (
    isZeroBytes(header.compositeFeedId) ||
    isZeroBytes(header.creator) ||
    isZeroBytes(header.quoteMint) ||
    isZeroBytes(header.componentSetHash) ||
    header.status !== 1 ||
    header.routeabilityCap !== RouteabilityStatus.SafetyOnly ||
    header.riskTier !== RiskTier.Unrated ||
    header.maxSnapshotAgeSlots === 0 ||
    header.maxComponentSnapshotAgeSlots === 0 ||
    header.maxComponentConfidenceBps > 10_000 ||
    header.maxComponentDispersionBps > 10_000 ||
    header.configRevision === 0n ||
    header.registryEpoch === 0n ||
    header.adminConfigRevisionAtCreation === 0n
  ) {
    throw new Error("InvalidCompositeFeed");
  }
  const expectedComponentSetHash = computeCompositeComponentSetHashForHeader(
    header,
    programId,
  );
  const expectedCompositeFeedId = computeCompositeFeedIdForHeader(header);
  const [, expectedCompositeFeedConfigBump] = findCompositeFeedConfigPda(
    header.compositeFeedId,
    programId,
  );
  if (
    !eqBytes(header.componentSetHash, expectedComponentSetHash) ||
    !eqBytes(header.compositeFeedId, expectedCompositeFeedId) ||
    header.bump !== expectedCompositeFeedConfigBump
  ) {
    throw new Error("InvalidCompositeFeed");
  }

  return header;
}

export function decodeCompositeSnapshotHeader(
  input: Uint8Array,
  programId: PublicKey = CANONICAL_MIMIR_PROGRAM_ID,
): CompositeSnapshotHeader {
  const header = decodeMimirBrowserCompositeSnapshotHeader(input);
  const [expectedCompositeConfig] = findCompositeFeedConfigPda(
    header.compositeFeedId,
    programId,
  );
  if (!eqBytes(header.compositeConfig, expectedCompositeConfig.toBytes())) {
    throw new Error("InvalidCompositeSnapshot");
  }
  return header;
}


/** Display/publication decode: Fresh or the program's exact Degraded CSP, bound to its config PDA. Never consumer admission. */
export function decodeCompositePublication(input: Uint8Array, programId: PublicKey = CANONICAL_MIMIR_PROGRAM_ID) {
  const header = decodeMimirBrowserCompositePublication(input);
  if (!eqBytes(header.compositeConfig, findCompositeFeedConfigPda(header.compositeFeedId, programId)[0].toBytes())) throw new Error("InvalidCompositeSnapshot");
  return header;
}



export function decodeGovernancePolicyHeader(input: Uint8Array): GovernancePolicyHeader {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < GOVERNANCE_POLICY_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (
    !eqBytes(
      data.subarray(
        GOVERNANCE_POLICY_OFFSETS.magic,
        GOVERNANCE_POLICY_OFFSETS.magic + 8,
      ),
      GOVERNANCE_POLICY_MAGIC,
    )
  ) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, GOVERNANCE_POLICY_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (
    readU16(data, GOVERNANCE_POLICY_OFFSETS.headerLen) !==
    GOVERNANCE_POLICY_HEADER_LEN
  ) {
    throw new Error("InvalidHeaderLength");
  }

  const header = {
    authority: bytes32(data, GOVERNANCE_POLICY_OFFSETS.authority),
    signer0: bytes32(data, GOVERNANCE_POLICY_OFFSETS.signer0),
    signer1: bytes32(data, GOVERNANCE_POLICY_OFFSETS.signer1),
    signer2: bytes32(data, GOVERNANCE_POLICY_OFFSETS.signer2),
    threshold: data[GOVERNANCE_POLICY_OFFSETS.threshold],
    status: data[GOVERNANCE_POLICY_OFFSETS.status],
    bump: data[GOVERNANCE_POLICY_OFFSETS.bump],
    minDelaySlots: readU64(data, GOVERNANCE_POLICY_OFFSETS.minDelaySlots),
    actionTtlSlots: readU64(data, GOVERNANCE_POLICY_OFFSETS.actionTtlSlots),
    revision: readU64(data, GOVERNANCE_POLICY_OFFSETS.revision),
  };

  validateEnum(header.status, GovernancePolicyStatus.Paused);
  if (
    isZeroBytes(header.authority) ||
    isZeroBytes(header.signer0) ||
    isZeroBytes(header.signer1) ||
    isZeroBytes(header.signer2) ||
    header.threshold === 0 ||
    header.threshold > 3 ||
    header.minDelaySlots === 0n ||
    header.actionTtlSlots <= header.minDelaySlots ||
    header.revision === 0n ||
    eqBytes(header.signer0, header.signer1) ||
    eqBytes(header.signer0, header.signer2) ||
    eqBytes(header.signer1, header.signer2)
  ) {
    throw new Error("InvalidGovernancePolicy");
  }
  return header;
}

export function decodeGovernanceActionHeader(input: Uint8Array): GovernanceActionHeader {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < GOVERNANCE_ACTION_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (
    !eqBytes(
      data.subarray(
        GOVERNANCE_ACTION_OFFSETS.magic,
        GOVERNANCE_ACTION_OFFSETS.magic + 8,
      ),
      GOVERNANCE_ACTION_MAGIC,
    )
  ) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, GOVERNANCE_ACTION_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (
    readU16(data, GOVERNANCE_ACTION_OFFSETS.headerLen) !==
    GOVERNANCE_ACTION_HEADER_LEN
  ) {
    throw new Error("InvalidHeaderLength");
  }

  const header = {
    policy: bytes32(data, GOVERNANCE_ACTION_OFFSETS.policy),
    actionHash: bytes32(data, GOVERNANCE_ACTION_OFFSETS.actionHash),
    targetKind: data[GOVERNANCE_ACTION_OFFSETS.targetKind],
    status: data[GOVERNANCE_ACTION_OFFSETS.status],
    approvalMask: data[GOVERNANCE_ACTION_OFFSETS.approvalMask],
    threshold: data[GOVERNANCE_ACTION_OFFSETS.threshold],
    proposedSlot: readU64(data, GOVERNANCE_ACTION_OFFSETS.proposedSlot),
    effectiveSlot: readU64(data, GOVERNANCE_ACTION_OFFSETS.effectiveSlot),
    expiresSlot: readU64(data, GOVERNANCE_ACTION_OFFSETS.expiresSlot),
    revision: readU64(data, GOVERNANCE_ACTION_OFFSETS.revision),
    bump: data[GOVERNANCE_ACTION_OFFSETS.bump],
  };

  validateEnum(header.status, GovernanceActionStatus.Consumed);
  if (
    (header.targetKind !== GovernanceActionTargetKind.Registry &&
      header.targetKind !== GovernanceActionTargetKind.Policy) ||
    isZeroBytes(header.actionHash) ||
    header.threshold === 0 ||
    header.threshold > 3 ||
    header.expiresSlot <= header.effectiveSlot ||
    header.revision === 0n
  ) {
    throw new Error("InvalidGovernanceAction");
  }
  return header;
}

export function decodeAdminConfigHeader(input: Uint8Array): AdminConfigHeader {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.length !== ADMIN_CONFIG_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (
    !eqBytes(
      data.subarray(ADMIN_CONFIG_OFFSETS.magic, ADMIN_CONFIG_OFFSETS.magic + 8),
      ADMIN_CONFIG_MAGIC,
    )
  ) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, ADMIN_CONFIG_OFFSETS.version) !== VERSION_V1) {
    throw new Error("UnsupportedVersion");
  }
  if (readU16(data, ADMIN_CONFIG_OFFSETS.headerLen) !== ADMIN_CONFIG_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }
  if (
    data[89] > 3 ||
    data
      .subarray(90, ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports)
      .some((byte) => byte !== 0)
  ) {
    throw new Error("InvalidAdminConfig");
  }

  const header = {
    compositeOwnerShareBps: readU16(
      data,
      ADMIN_CONFIG_OFFSETS.compositeOwnerShareBps,
    ),
    adminAuthority: bytes32(data, ADMIN_CONFIG_OFFSETS.adminAuthority),
    feedCreationCollateralMint: bytes32(data, ADMIN_CONFIG_OFFSETS.collateralMint),
    feedCreationCollateralAmountRaw: readU64(
      data,
      ADMIN_CONFIG_OFFSETS.collateralAmountRaw,
    ),
    feedCreationCollateralRequired: data[ADMIN_CONFIG_OFFSETS.collateralRequired],
    closePower: (data[89] & 1) !== 0,
    creationOpen: (data[89] & 2) !== 0,
    compositeRefreshFeeLamports: readU64(
      data,
      ADMIN_CONFIG_OFFSETS.compositeRefreshFeeLamports,
    ),
    compositeActivationOwnerFeeLamports: BigInt(
      data.readUInt32LE(ADMIN_CONFIG_OFFSETS.compositeActivationOwnerFeeLamports),
    ),
    compositeActivationTreasuryComponentFeeLamports: BigInt(
      data.readUInt32LE(ADMIN_CONFIG_OFFSETS.compositeActivationTreasuryComponentFeeLamports),
    ),
    compositeActivationTreasuryCreationFeeLamports: BigInt(
      data.readUInt32LE(ADMIN_CONFIG_OFFSETS.compositeActivationTreasuryCreationFeeLamports),
    ),
    tickerTierTenths: [116, 117, 118, 119].map((i) => data[i]) as unknown as readonly [number, number, number, number],
    feeTreasury: bytes32(data, ADMIN_CONFIG_OFFSETS.feeTreasury),
    configRevision: readU64(data, ADMIN_CONFIG_OFFSETS.configRevision),
    rentRecoveryDestination: bytes32(
      data,
      ADMIN_CONFIG_OFFSETS.rentRecoveryDestination,
    ),
    status: data[ADMIN_CONFIG_OFFSETS.status],
    bump: data[ADMIN_CONFIG_OFFSETS.bump],
  };

  if (
    header.status !== AdminConfigStatus.Active
  ) {
    throw new Error("InvalidAdminConfig");
  }
  if (
    isZeroBytes(header.adminAuthority) ||
    isZeroBytes(header.feeTreasury) ||
    isZeroBytes(header.rentRecoveryDestination) ||
    header.configRevision === 0n ||
    header.feedCreationCollateralRequired > 1 ||
    header.compositeOwnerShareBps > 10_000 ||
    header.compositeActivationOwnerFeeLamports > ADMIN_MAX_COMPOSITE_ACTIVATION_FEE_LAMPORTS ||
    header.compositeActivationTreasuryComponentFeeLamports > ADMIN_MAX_COMPOSITE_ACTIVATION_FEE_LAMPORTS ||
    header.compositeActivationTreasuryCreationFeeLamports > ADMIN_MAX_COMPOSITE_ACTIVATION_FEE_LAMPORTS
  ) {
    throw new Error("InvalidAdminConfig");
  }
  if (
    header.feedCreationCollateralRequired === 1 &&
    (isZeroBytes(header.feedCreationCollateralMint) ||
      header.feedCreationCollateralAmountRaw === 0n)
  ) {
    throw new Error("InvalidAdminConfig");
  }
  return header;
}

export function calculateFeedFeeVaultClaims(
  feeVault: FeedFeeVaultHeader,
): FeedFeeVaultClaimSummary {
  if (feeVault.ownerClaimedLamports > feeVault.ownerGeneratedLamports) {
    throw new Error("InvalidFeedFeeVault");
  }
  const ownerClaimableLamports =
    feeVault.ownerGeneratedLamports - feeVault.ownerClaimedLamports;
  return {
    eligible: ownerClaimableLamports > 0n,
    ownerGeneratedLamports: feeVault.ownerGeneratedLamports,
    ownerClaimedLamports: feeVault.ownerClaimedLamports,
    ownerClaimableLamports,
  };
}

export function decodeFeedFeeVaultHeader(input: Uint8Array): FeedFeeVaultHeader {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.length !== FEED_FEE_VAULT_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (
    !eqBytes(
      data.subarray(
        FEED_FEE_VAULT_OFFSETS.magic,
        FEED_FEE_VAULT_OFFSETS.magic + 8,
      ),
      FEED_FEE_VAULT_MAGIC,
    )
  ) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, FEED_FEE_VAULT_OFFSETS.version) !== VERSION_V1) {
    throw new Error("UnsupportedVersion");
  }
  if (
    readU16(data, FEED_FEE_VAULT_OFFSETS.headerLen) !==
    FEED_FEE_VAULT_HEADER_LEN
  ) {
    throw new Error("InvalidHeaderLength");
  }
  if (
    data
      .subarray(FEED_FEE_VAULT_OFFSETS.flags, FEED_FEE_VAULT_OFFSETS.feedId)
      .some((byte) => byte !== 0) ||
    data
      .subarray(
        FEED_FEE_VAULT_OFFSETS.reservedTail,
        FEED_FEE_VAULT_HEADER_LEN,
      )
      .some((byte) => byte !== 0)
  ) {
    throw new Error("InvalidFeedFeeVault");
  }

  const header = {
    feedId: bytes32(data, FEED_FEE_VAULT_OFFSETS.feedId),
    compositeConfig: bytes32(data, FEED_FEE_VAULT_OFFSETS.compositeConfig),
    identityAsset: bytes32(data, FEED_FEE_VAULT_OFFSETS.identityAsset),
    ownerGeneratedLamports: readU64(
      data,
      FEED_FEE_VAULT_OFFSETS.ownerGeneratedLamports,
    ),
    totalRefreshFeesLamports: readU64(
      data,
      FEED_FEE_VAULT_OFFSETS.totalRefreshFeesLamports,
    ),
    ownerClaimedLamports: readU64(
      data,
      FEED_FEE_VAULT_OFFSETS.ownerClaimedLamports,
    ),
    treasuryPaidLamports: readU64(
      data,
      FEED_FEE_VAULT_OFFSETS.treasuryPaidLamports,
    ),
    lastAccrualConfigRevision: readU64(
      data,
      FEED_FEE_VAULT_OFFSETS.lastAccrualConfigRevision,
    ),
    status: data[FEED_FEE_VAULT_OFFSETS.status],
    bump: data[FEED_FEE_VAULT_OFFSETS.bump],
  };

  validateEnum(header.status, FeedFeeVaultStatus.Active);
  if (
    header.status !== FeedFeeVaultStatus.Active ||
    isZeroBytes(header.feedId) ||
    isZeroBytes(header.compositeConfig) ||
    isZeroBytes(header.identityAsset) ||
    header.ownerClaimedLamports > header.ownerGeneratedLamports ||
    header.ownerGeneratedLamports + header.treasuryPaidLamports !==
      header.totalRefreshFeesLamports ||
    (header.totalRefreshFeesLamports === 0n) !==
      (header.lastAccrualConfigRevision === 0n)
  ) {
    throw new Error("InvalidFeedFeeVault");
  }
  calculateFeedFeeVaultClaims(header);
  return header;
}

export function decodeFeedReservationHeader(input: Uint8Array): FeedReservationHeader {
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (data.length < FEED_RESERVATION_HEADER_LEN) {
    throw new Error("InvalidAccountData");
  }
  if (!eqBytes(data.subarray(RESERVATION_OFFSETS.magic, RESERVATION_OFFSETS.magic + 8), FEED_RESERVATION_MAGIC)) {
    throw new Error("InvalidMagic");
  }
  if (readU16(data, RESERVATION_OFFSETS.version) !== VERSION_V0) {
    throw new Error("UnsupportedVersion");
  }
  if (readU16(data, RESERVATION_OFFSETS.headerLen) !== FEED_RESERVATION_HEADER_LEN) {
    throw new Error("InvalidHeaderLength");
  }
  if (
    data.subarray(RESERVATION_OFFSETS.flags, RESERVATION_OFFSETS.flags + 4).some((byte) => byte !== 0) ||
    data.subarray(RESERVATION_OFFSETS.bump + 1, RESERVATION_OFFSETS.registryEpoch).some((byte) => byte !== 0) ||
    data.subarray(RESERVATION_OFFSETS.reservationRevision + 8, FEED_RESERVATION_HEADER_LEN).some((byte) => byte !== 0)
  ) {
    throw new Error("InvalidFeedReservation");
  }

  const header = {
    feedId: bytes32(data, RESERVATION_OFFSETS.feedId),
    authority: bytes32(data, RESERVATION_OFFSETS.authority),
    baseMint: bytes32(data, RESERVATION_OFFSETS.baseMint),
    quoteMint: bytes32(data, RESERVATION_OFFSETS.quoteMint),
    maxRiskTier: data[RESERVATION_OFFSETS.maxRiskTier],
    status: data[RESERVATION_OFFSETS.status],
    bump: data[RESERVATION_OFFSETS.bump],
    registryEpoch: readU64(data, RESERVATION_OFFSETS.registryEpoch),
    reservationRevision: readU64(data, RESERVATION_OFFSETS.reservationRevision),
  };

  validateEnum(header.maxRiskTier, RiskTier.TierA);
  validateEnum(header.status, FeedReservationStatus.Revoked);
  const zero = new Uint8Array(32);
  if (
    eqBytes(header.feedId, zero) ||
    eqBytes(header.authority, zero) ||
    eqBytes(header.baseMint, zero) ||
    eqBytes(header.quoteMint, zero) ||
    eqBytes(header.baseMint, header.quoteMint) ||
    header.maxRiskTier === RiskTier.Unrated ||
    header.reservationRevision === 0n
  ) {
    throw new Error("InvalidFeedReservation");
  }
  return header;
}


export function computeLifecycleSourcingPlanHash(
  plan: LifecycleSourcingPlanHeader,
): Buffer {
  const u16 = (value: number) => {
    const out = Buffer.alloc(2);
    out.writeUInt16LE(value);
    return out;
  };
  const i32 = Buffer.alloc(4);
  i32.writeInt32LE(plan.priceExponent);
  return hashv([
    Buffer.from("MIMIR_MINT_ORACLE_PLAN_V3", "ascii"),
    Buffer.from([plan.hashSchemeVersion]),
    u16(plan.ringVersion),
    Buffer.from([plan.accountsBindingVersion]),
    plan.feedId,
    u16(plan.planId),
    u16(plan.planVersion),
    Buffer.from([
      plan.profile,
      plan.riskTier,
      plan.minSources,
      plan.minVenues,
      plan.minCorrelationGroups,
    ]),
    u16(plan.maxDispersionBps),
    u16(plan.maxSourceActivityAgeSlots),
    i32,
    plan.baseMint,
    plan.quoteMint,
    plan.sourceSetHash,
    plan.accountsHash,
    plan.twapState,
    plan.anchorPolicyHash,
    u64Le(plan.adapterMask),
  ]);
}

export function decodeLifecycleSourcingPlanHeader(
  input: Uint8Array,
): LifecycleSourcingPlanHeader {
  if (input.byteLength !== SOURCING_PLAN_HEADER_LEN) {
    throw new Error("InvalidLifecycleSourcingPlan");
  }
  const data = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const plan: LifecycleSourcingPlanHeader = {
    ...decodeSourcingPlanHeader(data),
    hashSchemeVersion: data[PLAN_OFFSETS.hashSchemeVersion],
    ringVersion: readU16(data, PLAN_OFFSETS.ringVersion),
    accountsBindingVersion: data[PLAN_OFFSETS.accountsBindingVersion],
  };
  if (
    plan.hashSchemeVersion !== PLAN_HASH_SCHEME_MERKLE_V1 ||
    plan.ringVersion !== PLAN_CANONICAL_RING_VERSION_MERKLE_V1 ||
    plan.accountsBindingVersion !== PLAN_ACCOUNTS_BINDING_STATIC_V1 ||
    data.subarray(PLAN_OFFSETS.reservedTail).some((byte) => byte !== 0) ||
    plan.status !== PlanStatus.Active ||
    plan.minSources < 1 ||
    plan.minSources > MAX_TWAP_AGGREGATION_SOURCES ||
    plan.adapterMask === 0n ||
    isZeroBytes(plan.sourceSetHash) ||
    isZeroBytes(plan.accountsHash) ||
    isZeroBytes(plan.anchorPolicyHash) ||
    !eqBytes(plan.planHash, computeLifecycleSourcingPlanHash(plan))
  ) {
    throw new Error("InvalidLifecycleSourcingPlan");
  }
  return plan;
}

function lifecycleSourceLeaf(source: SourceConfigHeader): Buffer {
  const material = Buffer.alloc(362);
  let offset = 0;
  material[offset++] = 1;
  for (const value of [source.feedId]) { Buffer.from(value).copy(material, offset); offset += 32; }
  for (const value of [source.sourceIndex, source.adapterType, source.status, source.direction]) material[offset++] = value;
  for (const value of [source.adapterVersion, source.venueGroup, source.operatorGroup, source.liquidityOwnerGroup,
    source.routeCorrelationGroup, source.quoteAssetGroup, source.bridgeOrWrapperGroup, source.oracleSourceClass,
    source.upgradeAuthorityGroup, source.maxSourceWeightBps]) { material.writeUInt16LE(value, offset); offset += 2; }
  for (const value of [source.minLiquidityNative, source.minDepthTo50BpsNative]) {
    material.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
    material.writeBigUInt64LE(value >> 64n, offset + 8);
    offset += 16;
  }
  for (const value of [source.programId, source.poolOrMarket, source.baseVault, source.quoteVault,
    source.baseMint, source.quoteMint, source.tokenProgram, source.vaultAuthority]) {
    Buffer.from(value).copy(material, offset); offset += 32;
  }
  for (const value of [source.sourceConfigRevision, source.sourceSetRevision]) {
    material.writeBigUInt64LE(value, offset); offset += 8;
  }
  material[offset++] = source.bump;
  if (offset !== material.length) throw new Error("InvalidLifecycleSourceSet");
  if (source.flags === 1) return hashv([Buffer.from("MIMIR_SOURCE_CONFIG_POINT_V1", "ascii"), material, Buffer.from([1, 0, 0, 0])]);
  if (source.flags !== 0) throw new Error("InvalidLifecycleSourceSet");
  return hashv([Buffer.from("MIMIR_SOURCE_CONFIG_LEAF_V1", "ascii"), material]);
}

export function computeLifecycleSourceSetRoot(
  feedId: Uint8Array,
  sourceConfigs: readonly SourceConfigHeader[],
): Buffer {
  if (sourceConfigs.length < 1 || sourceConfigs.length > MAX_TWAP_AGGREGATION_SOURCES) {
    throw new Error("InvalidLifecycleSourceSet");
  }
  let nodes = Array.from({ length: PLAN_MEMBERSHIP_LEAF_COUNT_V1 }, (_, index) =>
    index < sourceConfigs.length
      ? lifecycleSourceLeaf(sourceConfigs[index]!)
      : hashv([Buffer.from("MIMIR_SOURCE_CONFIG_EMPTY_V1", "ascii"), Buffer.from([1]), feedId, Buffer.from([index])]),
  );
  for (let level = 0; nodes.length > 1; level += 1) {
    const parents: Buffer[] = [];
    for (let index = 0; index < nodes.length; index += 2) {
      parents.push(hashv([Buffer.from("MIMIR_MERKLE_NODE_V1", "ascii"), Buffer.from([1, level, index / 2]), nodes[index]!, nodes[index + 1]!]));
    }
    nodes = parents;
  }
  return nodes[0]!;
}


export function verifySourceConfigHeader(
  sourceConfig: SourceConfigHeader,
  expectedFeedId: Uint8Array,
  expectedSourceIndex: number,
): void {
  if (!eqBytes(sourceConfig.feedId, expectedFeedId) || sourceConfig.sourceIndex !== expectedSourceIndex) {
    throw new Error("InvalidSourceConfig");
  }
  if (sourceConfig.status !== SourceStatus.Active) throw new Error("SourceConfigNotActive");
  if (!sourceAdapterSupportsVersion(sourceConfig.adapterType, sourceConfig.adapterVersion)) {
    throw new Error("UnsupportedVersion");
  }
  if (sourceConfig.sourceConfigRevision === 0n || sourceConfig.sourceSetRevision === 0n) {
    throw new Error("InvalidSourceConfig");
  }
}



export function readRaydiumClmmPoolAmmConfig(poolStateData: Uint8Array): Bytes32 {
  const data = Buffer.from(
    poolStateData.buffer,
    poolStateData.byteOffset,
    poolStateData.byteLength,
  );
  if (
    data.length <= RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG + 31 ||
    !eqBytes(
      data.subarray(0, RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR.length),
      RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR,
    )
  ) {
    throw new Error("InvalidRaydiumClmmPoolState");
  }
  return bytes32(data, RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG);
}

export function readRaydiumClmmPoolObservationKey(poolStateData: Uint8Array): Bytes32 {
  const data = Buffer.from(poolStateData.buffer, poolStateData.byteOffset, poolStateData.byteLength);
  if (data.length !== 1544 || !eqBytes(data.subarray(0, 8), RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR)) {
    throw new Error("InvalidRaydiumClmmPoolState");
  }
  const observation = bytes32(data, 201);
  if (observation.every((byte) => byte === 0)) throw new Error("InvalidRaydiumClmmPoolState");
  return observation;
}





export function projectRaydiumCpmmObservationAfterCrank(
  params: ProjectRaydiumCpmmObservationAfterCrankParams,
): Uint8Array {
  const out = Buffer.from(params.observationData);
  const observationIndex = readU16(
    out,
    RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET,
  );
  const latestOffset = raydiumCpmmObservationOffset(observationIndex);
  const latestTimestamp = readU64(
    out,
    latestOffset + RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET,
  );
  let lastUpdateTimestamp = readU64(
    out,
    RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
  );
  if (lastUpdateTimestamp === 0n) {
    lastUpdateTimestamp = latestTimestamp;
    writeU64(
      out,
      RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
      lastUpdateTimestamp,
    );
  }
  const timeSinceLastObservation =
    params.currentUnixTs > latestTimestamp
      ? params.currentUnixTs - latestTimestamp
      : 0n;
  const timeSinceLastUpdate =
    params.currentUnixTs > lastUpdateTimestamp
      ? params.currentUnixTs - lastUpdateTimestamp
      : 0n;
  if (timeSinceLastObservation === 0n || timeSinceLastUpdate === 0n) {
    return out;
  }
  const nextCumulative0 =
    readU128(
      out,
      latestOffset +
        RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET,
    ) + params.token0PriceX32 * timeSinceLastUpdate;
  const nextCumulative1 =
    readU128(
      out,
      latestOffset +
        RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET,
    ) + params.token1PriceX32 * timeSinceLastUpdate;
  let writeOffset = latestOffset;
  if (
    timeSinceLastObservation >=
    RAYDIUM_CPMM_OBSERVATION_UPDATE_DURATION_SECS
  ) {
    const nextIndex =
      observationIndex ===
      RAYDIUM_CPMM_OBSERVATION_STATE_OBSERVATION_COUNT - 1
        ? 0
        : observationIndex + 1;
    out.writeUInt16LE(nextIndex, RAYDIUM_CPMM_OBSERVATION_STATE_INDEX_OFFSET);
    writeOffset = raydiumCpmmObservationOffset(nextIndex);
    writeU64(
      out,
      writeOffset + RAYDIUM_CPMM_OBSERVATION_TIMESTAMP_OFFSET,
      params.currentUnixTs,
    );
  }
  writeU128Wrapping(
    out,
    writeOffset +
      RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN0_PRICE_X32_OFFSET,
    nextCumulative0,
  );
  writeU128Wrapping(
    out,
    writeOffset +
      RAYDIUM_CPMM_OBSERVATION_CUMULATIVE_TOKEN1_PRICE_X32_OFFSET,
    nextCumulative1,
  );
  writeU64(
    out,
    RAYDIUM_CPMM_OBSERVATION_STATE_LAST_UPDATE_TIMESTAMP_OFFSET,
    params.currentUnixTs,
  );
  return out;
}



export function computeRaydiumCpmmNativeTwapPriceX64ForFeed(params: {
  poolStateAddress: Uint8Array;
  poolStateData: Uint8Array;
  sourceConfig: SourceConfigHeader;
  feedConfig: FeedConfigHeader;
  direction: number;
  sample: RaydiumCpmmNativeTwapObservationSample;
}): bigint {
  if (
    params.poolStateAddress.length !== 32 ||
    !eqBytes(params.poolStateAddress, params.sourceConfig.poolOrMarket) ||
    params.direction !== params.sourceConfig.direction
  ) {
    throw new Error("InvalidSourceConfig");
  }
  const token0IsBase = raydiumCpmmPoolToken0IsBaseForFeed(
    params.poolStateData,
    params.feedConfig,
    params.sourceConfig,
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


export function decodeSourceObservationRingHeader(input: Uint8Array): SourceObservationRingHeader {
  return decodeMimirBrowserSourceRingV1(input);
}

export function decodeSourceObservationRingV1Header(input: Uint8Array): SourceObservationRingV1Header {
  return decodeMimirBrowserSourceRingV1(input);
}

export function decodeSourceTemporalModuleV1(input: Uint8Array, ring: SourceObservationRingV1Header) {
  return decodeMimirBrowserSourceTemporalModuleV1(input, ring);
}

export function decodeCpmmQuietTemporalModuleV2(input: Uint8Array, ring: SourceObservationRingV1Header) {
  return decodeMimirBrowserCpmmQuietTemporalModuleV2(input, ring);
}

export function verifySourceObservationRingHeader(
  ring: SourceObservationRingHeader | SourceObservationRingV1Header,
  expectedFeedId: Uint8Array,
  expectedSourceIndex: number,
  expectedRingVersion: number,
  expectedPlanHash: Uint8Array,
  clockSlot: bigint,
  maxObservationAgeSlots: number,
): void {
  if (
    !eqBytes(ring.feedId, expectedFeedId) ||
    ring.sourceIndex !== expectedSourceIndex ||
    expectedRingVersion !== 1 ||
    ring.ringVersion !== 1 ||
    !("completedEndSlot" in ring) ||
    ring.observationKind !== ObservationKind.Spot
  ) {
    throw new Error("InvalidSourceRing");
  }
  if (ring.status !== SourceStatus.Active) throw new Error("SourceRingNotActive");
  if (!eqBytes(ring.selectedPlanHash, expectedPlanHash)) throw new Error("InvalidPlan");
  if (ring.windowFlags !== 3) throw new Error("InvalidSourceRing");
  if (ring.newestSlot > clockSlot || ring.completedEndSlot > clockSlot) {
    throw new Error("StaleSourceActivity");
  }
  if (clockSlot - ring.completedEndSlot > BigInt(maxObservationAgeSlots)) {
    throw new Error("StaleSourceActivity");
  }
}


export function verifyFeedTwapStateHeader(
  twap: FeedTwapStateHeader,
  expectedFeedId: Uint8Array,
  expectedTwapVersion: number,
  expectedPlanHash: Uint8Array,
  clockSlot: bigint,
  maxTwapAgeSlots: number,
  maxSourceActivityAgeSlots = maxTwapAgeSlots,
): void {
  if (!eqBytes(twap.feedId, expectedFeedId) || twap.twapVersion !== expectedTwapVersion) {
    throw new Error("InvalidTwapState");
  }
  if (twap.status !== TwapStatus.Active) throw new Error("TwapStateNotActive");
  if (twap.revision === 0n || twap.sourceSetRevision === 0n) throw new Error("InvalidTwapState");
  if (!eqBytes(twap.selectedPlanHash, expectedPlanHash)) throw new Error("InvalidPlan");
  if (twap.shortEndSlot > clockSlot || twap.mediumEndSlot > clockSlot || twap.longEndSlot > clockSlot) {
    throw new Error("StaleSnapshot");
  }
  if (clockSlot - twap.shortEndSlot > BigInt(maxTwapAgeSlots)) throw new Error("StaleSnapshot");
  if (twap.sourceActivitySlotMin > clockSlot) throw new Error("StaleSourceActivity");
  if (clockSlot - twap.sourceActivitySlotMin > BigInt(maxSourceActivityAgeSlots)) {
    throw new Error("StaleSourceActivity");
  }
}


export function verifySnapshotHeader(
  header: FeedSnapshotHeader,
  policy: SnapshotPolicy,
  context?: {
    snapshot?: PublicKey;
    programId?: PublicKey;
  },
): void {
  verifySnapshotHeaderPolicy(header, policy, () => {
    if ((policy.flags & VerifyFlags.RequireCanonicalSnapshot) !== 0) {
      if (!context?.snapshot) throw new Error("MissingSnapshotAddress");
      const expectedSnapshot = findFeedSnapshotPda(
        policy.expectedFeedId,
        context.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
      )[0];
      if (!context.snapshot.equals(expectedSnapshot)) {
        throw new Error("InvalidSnapshotAddress");
      }
    }
  });
}

export { assertPlainSnapshotSource, verifyFeedConfigForSnapshot };

export function verifyRegistryForSnapshot(
  registry: OracleRegistryHeader,
  snapshot: FeedSnapshotHeader,
  feedConfig?: FeedConfigHeader,
): void {
  if (registry.status !== RegistryStatus.Active) throw new Error("RegistryNotActive");
  if (registry.registryEpoch < snapshot.registryEpoch) throw new Error("RegistryEpochMismatch");
  if (feedConfig && registry.registryEpoch < feedConfig.registryEpoch) {
    throw new Error("RegistryEpochMismatch");
  }
  if (registry.minFeedConfigVersion > VERSION_V0) throw new Error("UnsupportedVersion");
  verifyRegistryAdapterVersionPolicy(registry);
}

export function verifySourcingPlanForSnapshot(
  plan: SourcingPlanHeader,
  snapshot: FeedSnapshotHeader,
  policy: SnapshotPolicy,
  feedConfig?: FeedConfigHeader,
  registry?: OracleRegistryHeader,
): void {
  if (!eqBytes(plan.feedId, snapshot.feedId)) throw new Error("InvalidFeed");
  if (plan.status !== PlanStatus.Active) throw new Error("SourcingPlanNotActive");
  if (
    plan.planId !== snapshot.sourcingPlanId ||
    plan.planVersion !== snapshot.sourcingPlanVersion ||
    plan.profile !== snapshot.planProfile ||
    !eqBytes(plan.planHash, snapshot.sourcingPlanHash)
  ) {
    throw new Error("InvalidPlan");
  }
  if (plan.priceExponent !== snapshot.priceExponent) throw new Error("InvalidExponent");
  if (snapshot.riskTier > plan.riskTier) throw new Error("InvalidRouteability");
  if (snapshot.sourceCount < plan.minSources) throw new Error("InsufficientSourceCount");
  if (snapshot.venueCount < plan.minVenues) throw new Error("InsufficientVenueCount");
  if (snapshot.correlationGroupCount < plan.minCorrelationGroups) {
    throw new Error("InsufficientCorrelationGroupCount");
  }
  if (snapshot.dispersionBps > plan.maxDispersionBps) throw new Error("DispersionTooWide");
  if (![1, 5, 6, 7].includes(snapshot.snapshotSource) && snapshot.oldestSourceActivitySlot > policy.clockSlot) {
    throw new Error("StaleSourceActivity");
  }
  if (
    ![1, 5, 6, 7].includes(snapshot.snapshotSource) &&
    policy.clockSlot - snapshot.oldestSourceActivitySlot >
    BigInt(plan.maxSourceActivityAgeSlots)
  ) {
    throw new Error("StaleSourceActivity");
  }
  if (!eqBytes(snapshot.anchorPolicyHash, plan.anchorPolicyHash)) {
    throw new Error("InvalidAnchorPolicy");
  }
  const zeroHash = new Uint8Array(32);
  if (eqBytes(plan.planHash, zeroHash)) {
    throw new Error("InvalidPlan");
  }
  if (eqBytes(plan.sourceSetHash, zeroHash) || eqBytes(plan.accountsHash, zeroHash)) {
    throw new Error("InvalidSourcingPlanAccountHash");
  }
  if (
    registry &&
    (registry.supportedAdapterMask === 0n ||
      (plan.adapterMask & registry.supportedAdapterMask) !== plan.adapterMask)
  ) {
    throw new Error("InvalidPlan");
  }
  if (registry) verifyRegistryAdapterVersionPolicy(registry);
  if (feedConfig && !eqBytes(plan.sourceSetHash, feedConfig.sourceSetHash)) {
    throw new Error("InvalidSourcingPlanAccountHash");
  }
}

export function decodeDammReserveTemporalModuleV3(input: Uint8Array, ring: SourceObservationRingV1Header) {
  return decodeMimirBrowserDammReserveTemporalModuleV3(input, ring);
}
