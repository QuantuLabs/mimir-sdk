import { MIMIR_CURRENT_POINT_RECOMMENDED_POSITION_USDC6, mimirCurrentPointAdmitted, mimirCurrentPointCaps, mimirCurrentPointFloorBudget,
  type MimirCurrentPointCaps } from "../internal/currentPointCore.js";
import type { Address } from "@solana/kit";
import { conservativeMintOracleSourceConfigFloor } from "../math.js";
import { addressBytes, bytesAddress, canonicalJson, domainHash, fromBase64, isZeroBytes } from "./bytes.js";
import type { MimirBetaCluster } from "./deployment.js";
import { betaError, MimirBetaError, MimirBetaPoolIneligibleError, MimirBetaStalePreparationError, type MimirBetaIneligibleReason } from "./errors.js";
import { sourceAdapterSupportsVersion, type MimirBetaAdapterType, type MimirBetaAdapterVersion, type MimirBetaCount, type MimirBetaSourceFamily } from "./types.js";
import {
  type PoolCoreAccount,
  type PoolCoreCandidate,
  type PoolCoreLayout,
} from "../internal/rpcPoolDiscoveryCore.js";
import {
  assertUnambiguousMimirBetaCaptureCandidates,
  compareMimirBetaCaptureCandidates,
  decodeMimirBetaCaptureCandidate,
  deriveMimirBetaCaptureReadPlan,
  mimirBetaCapturePoolCoreLayout,
  mimirBetaCaptureScanDescriptors,
  type MimirBetaCapturedAccount,
  type MimirBetaCaptureCandidate,
  type MimirBetaCaptureReadNode,
  type MimirBetaCaptureReadPlan,
  type MimirBetaCaptureScanDescriptor,
} from "./capture.js";
import { MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_TOKEN_2022_PROGRAM_ID, deriveMimirBetaPumpSwapBoostVault } from "./capture.js";

const CLOCK_SYSVAR = "SysvarC1ock11111111111111111111111111111111" as Address;
const SYSVAR_OWNER = "Sysvar1111111111111111111111111111111111111" as Address;

export interface MimirBetaPoolDiscoverySource {
  /** Exact complete exported descriptor set for one family (CPMM has two allocations). */
  readonly layouts: readonly PoolCoreLayout[] | string;
  loadProgram(): Promise<Readonly<{ executable: boolean }> | string>;
  scan(args: Readonly<{ baseMint: Address; quoteMint: Address }>): Promise<readonly PoolCoreAccount[] | string>;
}

export interface MimirBetaCapturePlanAccountLoader {
  loadCapturePlanAccounts(args: Readonly<{
    minContextSlot: bigint;
    plans: readonly Readonly<{
      planHash: string;
      descriptorId: string;
      descriptorHash: string;
      addresses: readonly Address[];
      nodes: readonly MimirBetaCaptureReadNode[];
    }>[];
  }>): Promise<Readonly<{ contextSlot: bigint; accounts: readonly MimirBetaCapturedAccount[] }> | string>;
}

export interface MimirBetaPoolSourceDescriptor {
  readonly family: MimirBetaSourceFamily;
  readonly adapterType: MimirBetaAdapterType;
  readonly priority: "production-priority" | "adapter-separate";
  readonly programId: Address;
  readonly layoutHash: string;
  readonly supportedBindingVariants: readonly ("direct" | "routeable")[];
}

export type MimirBetaStaticAccountRole =
  | "base-mint" | "quote-mint"
  | "base-vault" | "quote-vault" | "pool"
  | "token2022-mint"
  | "whirlpools-config" | "amm-config"
  | "open-orders" | "market" | "market-program"
  | "global-config" | "fee-config";

export interface MimirBetaPoolCreationBinding {
  readonly adapterType: MimirBetaAdapterType;
  readonly adapterVersion: MimirBetaAdapterVersion;
  readonly bindingVariant: "direct" | "routeable";
  readonly tokenProgramId: Address;
  readonly token2022Mint: Address | null;
  readonly vaultAuthority: Address;
  readonly staticAccounts: readonly Readonly<{ role: MimirBetaStaticAccountRole; address: Address }>[];
  readonly observationState: Address | null;
  readonly operatorGroup: number;
  readonly liquidityOwnerGroup: number;
  readonly quoteAssetGroup: number;
  readonly bridgeOrWrapperGroup: number;
  readonly oracleSourceClass: number;
  readonly upgradeAuthorityGroup: number;
}

export interface MimirBetaEligiblePool {
  readonly eligibility: "eligible";
  readonly family: MimirBetaSourceFamily;
  readonly programId: Address;
  readonly pool: Address;
  readonly descriptorId: string;
  readonly descriptorHash: string;
  readonly readPlan: MimirBetaCaptureReadPlan;
  readonly canonicalMint0: Address;
  readonly canonicalMint1: Address;
  readonly canonicalPairKey: string;
  readonly direction: "quote-per-base";
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly adapterVersion: MimirBetaAdapterVersion;
  readonly token2022Mint: Address | null;
  readonly token2022PolicyHash: string | null;
  readonly minLiquidityNative: bigint;
  readonly minDepthTo50BpsNative: bigint;
  readonly observedSlot: bigint;
  readonly validThroughSlot: bigint;
  readonly evidenceHash: string;
  readonly creation: MimirBetaPoolCreationBinding;
  /** Zero-fee AMM-v4/PumpSwap: the source ring is point-only, so readiness comes after warming. */
  readonly pointOnly?: true;
  readonly boostVaultLamports?: bigint;
  readonly maxBoostDriftBps?: bigint;
  readonly pumpSwapBaseIsA?: boolean;
}

const eligiblePoolConditions = new WeakMap<MimirBetaEligiblePool, number>();
/** @internal Mimir condition word observed by the authenticated capture that produced this eligible pool. */
export function mimirBetaEligiblePoolConditions(pool: MimirBetaEligiblePool): number {
  return eligiblePoolConditions.get(pool) ?? 0;
}

export interface MimirBetaIneligiblePool {
  readonly eligibility: "ineligible";
  readonly family: MimirBetaSourceFamily;
  readonly programId: Address;
  readonly pool: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly exclusionCode: NonNullable<PoolCoreCandidate["exclusion"]> | "TOKEN_PROGRAM_PAIR_UNSUPPORTED" | "TOKEN_2022_POLICY_UNSUPPORTED" | "CONFIDENCE_EXCEEDS_POLICY" | "POOL_INELIGIBLE";
  readonly exclusionReason?: MimirBetaIneligibleReason;
}

export type MimirBetaPool = MimirBetaEligiblePool | MimirBetaIneligiblePool;

export interface MimirBetaPoolSearchResult {
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly query: string;
  readonly observedSlot: bigint;
  readonly pools: readonly MimirBetaPool[];
  readonly recommendedPools: readonly MimirBetaEligiblePool[];
  readonly maxPools: MimirBetaCount;
  readonly searchHash: string;
}

export interface MimirBetaPoolDiscovery {
  listPoolSources(): Promise<readonly MimirBetaPoolSourceDescriptor[]>;
  searchSpotPools(args: Readonly<{ baseMint: Address; quoteMint: Address; query: string; maxPools: MimirBetaCount }>): Promise<MimirBetaPoolSearchResult>;
  revalidateSelectedPools(args: Readonly<{ pools: readonly MimirBetaEligiblePool[]; minContextSlot: bigint; maxConfidenceBps?: number }>): Promise<Readonly<{
    slot: bigint;
    pools: readonly MimirBetaEligiblePool[];
    freshPools: readonly MimirBetaEligiblePool[];
  }>>;
}

export type MimirBetaPoolSearchArgs = Parameters<MimirBetaPoolDiscovery["searchSpotPools"]>[0];
export type MimirBetaPoolRevalidationArgs = Parameters<MimirBetaPoolDiscovery["revalidateSelectedPools"]>[0];

/** Injected discovery accepts either the normal object arguments or canonicalJson's decimal-string/base64 JSON representation. */
export interface MimirBetaInjectedPoolDiscovery extends MimirBetaPoolDiscovery {
  searchSpotPools(args: MimirBetaPoolSearchArgs | string): ReturnType<MimirBetaPoolDiscovery["searchSpotPools"]>;
  revalidateSelectedPools(args: MimirBetaPoolRevalidationArgs | string): ReturnType<MimirBetaPoolDiscovery["revalidateSelectedPools"]>;
}

export interface CreateInjectedPoolDiscoveryConfig extends MimirBetaCapturePlanAccountLoader {
  readonly cluster: MimirBetaCluster;
  readonly sources: readonly MimirBetaPoolDiscoverySource[];
  readonly evidenceTtlSlots: bigint;
  readonly maxScanResultsPerFamily: number;
  readonly maxConfidenceBps?: number;
  /** Existing-feed rediscovery: see `MimirBetaCaptureCandidateInput.existingFeed`. */
  readonly existingFeed?: true;
  getContext(): Promise<Readonly<{ slot: bigint; unixTimestamp: bigint }> | string>;
}

const FAMILY = {
  "orca-whirlpool": { adapterType: 0, priority: "production-priority", variants: ["routeable"], creationVariant: "routeable", group: 4, roles: ["base-vault", "quote-vault", "pool", "whirlpools-config"] },
  "raydium-clmm": { adapterType: 1, priority: "production-priority", variants: ["routeable"], creationVariant: "routeable", group: 1, roles: ["base-vault", "quote-vault", "pool", "amm-config"] },
  "raydium-cpmm": { adapterType: 2, priority: "adapter-separate", variants: ["direct"], creationVariant: "direct", group: 5, roles: ["base-vault", "quote-vault", "pool", "amm-config"] },
  "raydium-amm-v4": { adapterType: 4, priority: "adapter-separate", variants: ["direct"], creationVariant: "direct", group: 7, roles: ["base-vault", "quote-vault", "pool", "open-orders", "market", "market-program"] },
  "pumpswap": { adapterType: 6, priority: "adapter-separate", variants: ["direct"], creationVariant: "direct", group: 8, roles: ["base-mint", "quote-mint", "base-vault", "quote-vault", "pool", "global-config", "fee-config"] },
  "meteora-dlmm": { adapterType: 3, priority: "production-priority", variants: ["direct", "routeable"], creationVariant: "direct", group: 2, roles: ["base-vault", "quote-vault", "pool"] },
  "meteora-damm-v2": { adapterType: 7, priority: "production-priority", variants: ["direct"], creationVariant: "direct", group: 3, roles: ["base-vault", "quote-vault", "pool"] },
} as const;

async function layoutHash(family: MimirBetaSourceFamily, cluster: MimirBetaCluster): Promise<string> {
  const payload = mimirBetaCaptureScanDescriptors(cluster)
    .filter((descriptor) => descriptor.family === family)
    .map((descriptor) => Object.fromEntries(Object.entries(descriptor).filter(([, value]) => value !== undefined)));
  return domainHash("MIMIR_BETA_POOL_LAYOUT_V1\0", canonicalJson(payload as never));
}

function safeU16(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) betaError("INVALID_ARGUMENT", `${label} out of range`);
}

export function buildMimirBetaPoolCreationBinding(candidate: MimirBetaCaptureCandidate,
  bindingVariant?: "direct" | "routeable"): MimirBetaPoolCreationBinding {
  const spec = FAMILY[candidate.family];
  if (bindingVariant !== undefined && !(spec.variants as readonly string[]).includes(bindingVariant)) {
    betaError("INVALID_ARGUMENT", `${candidate.family} does not support the ${String(bindingVariant)} binding variant`, candidate.pool);
  }
  const evidence = new Map(candidate.capacityEvidence.map((entry) => [entry.role, entry.address]));
  const roles = (candidate.family === "raydium-clmm" || candidate.family === "meteora-dlmm") && candidate.adapterVersion === 1
    ? [...spec.roles, "token2022-mint" as const]
    : spec.roles;
  const staticAccounts = roles.map((role) => Object.freeze({
    role,
    address: role === "token2022-mint"
      ? candidate.token2022Mint ?? betaError("PROGRAM_ABI_MISMATCH", "V1 candidate lacks Token-2022 mint", candidate.pool)
      : evidence.get(role) ?? betaError("PROGRAM_ABI_MISMATCH", "creation account lacks capture evidence", candidate.pool),
  }));
  const creation = snapshotCreationBinding({
    adapterType: spec.adapterType,
    adapterVersion: candidate.adapterVersion,
    bindingVariant: bindingVariant ?? spec.creationVariant,
    tokenProgramId: candidate.tokenProgramId,
    token2022Mint: candidate.token2022Mint,
    vaultAuthority: candidate.vaultAuthority,
    staticAccounts,
    observationState: candidate.observationState,
    operatorGroup: spec.group,
    liquidityOwnerGroup: 0xffff,
    quoteAssetGroup: 1,
    bridgeOrWrapperGroup: 0,
    oracleSourceClass: spec.group,
    upgradeAuthorityGroup: spec.group,
  });
  validateCreation(candidate, creation);
  return creation;
}

/**
 * Selects a supported per-pool binding variant (DLMM: `"direct"` default or `"routeable"`). The next revalidation, which every creation
 * path performs, keeps the variant and re-hashes the pool evidence.
 */
export function withMimirBetaPoolBindingVariant(pool: MimirBetaEligiblePool, bindingVariant: "direct" | "routeable"): MimirBetaEligiblePool {
  const spec = FAMILY[pool.family] ?? betaError("INVALID_ARGUMENT", "pool family is unknown", pool.pool);
  if (!(spec.variants as readonly string[]).includes(bindingVariant)) {
    betaError("INVALID_ARGUMENT", `${pool.family} does not support the ${String(bindingVariant)} binding variant`, pool.pool);
  }
  if (pool.creation.bindingVariant === bindingVariant) return pool;
  return Object.freeze({ ...pool, creation: snapshotCreationBinding({ ...pool.creation, bindingVariant }) });
}

function validateCreation(candidate: MimirBetaCaptureCandidate, creation: MimirBetaPoolCreationBinding): void {
  const spec = FAMILY[candidate.family];
  if (creation.adapterType !== spec.adapterType || !sourceAdapterSupportsVersion(creation.adapterType, creation.adapterVersion) ||
    !(spec.variants as readonly string[]).includes(creation.bindingVariant)) betaError("PROGRAM_ABI_MISMATCH", "discovery binding family mismatch", candidate.pool);
  if (candidate.family !== "raydium-clmm" && candidate.family !== "meteora-dlmm" && candidate.family !== "pumpswap" && creation.adapterVersion !== 0) {
    betaError("PROGRAM_ABI_MISMATCH", "adapter V1 binding is unsupported", candidate.pool);
  }
  if (candidate.family === "raydium-clmm" && creation.adapterVersion === 1 && creation.bindingVariant !== "routeable") {
    betaError("PROGRAM_ABI_MISMATCH", "CLMM V1 binding must be routeable", candidate.pool);
  }
  const expectedRoles = ((candidate.family === "raydium-clmm" || candidate.family === "meteora-dlmm") && creation.adapterVersion === 1
    ? [...spec.roles, "token2022-mint"]
    : spec.roles) as readonly MimirBetaStaticAccountRole[];
  if (creation.staticAccounts.length !== expectedRoles.length ||
    creation.staticAccounts.some((entry, index) => entry.role !== expectedRoles[index])) betaError("PROGRAM_ABI_MISMATCH", "discovery static role order mismatch", candidate.pool);
  const evidence = new Map(candidate.capacityEvidence.map((entry) => [entry.role, entry]));
  const expectedAddresses = candidate.family === "pumpswap"
    ? [candidate.baseMint, candidate.quoteMint, candidate.baseVault, candidate.quoteVault, candidate.pool,
      evidence.get("global-config")?.address, evidence.get("fee-config")?.address]
    : candidate.family === "raydium-amm-v4"
      ? [candidate.baseVault, candidate.quoteVault, candidate.pool, evidence.get("open-orders")?.address,
        evidence.get("market")?.address, evidence.get("market-program")?.address]
      : candidate.family === "raydium-clmm" && creation.adapterVersion === 1
        ? [candidate.baseVault, candidate.quoteVault, candidate.pool, candidate.familyConfig ?? undefined, candidate.token2022Mint ?? undefined]
      : candidate.family === "meteora-dlmm" && creation.adapterVersion === 1
        ? [candidate.baseVault, candidate.quoteVault, candidate.pool, candidate.token2022Mint ?? undefined]
      : [candidate.baseVault, candidate.quoteVault, candidate.pool,
        ...(expectedRoles.length === 4 ? [candidate.familyConfig ?? undefined] : [])];
  if (expectedAddresses.some((address) => address === undefined) ||
      creation.staticAccounts.some((entry, index) => entry.address !== expectedAddresses[index])) {
    betaError("PROGRAM_ABI_MISMATCH", "discovery static account binding mismatch", candidate.pool);
  }
  if ((candidate.family === "raydium-cpmm") !== (creation.observationState !== null)) {
    betaError("PROGRAM_ABI_MISMATCH", "CPMM observation binding mismatch", candidate.pool);
  }
  if (creation.tokenProgramId !== candidate.tokenProgramId || creation.token2022Mint !== candidate.token2022Mint || creation.vaultAuthority !== candidate.vaultAuthority ||
      creation.observationState !== candidate.observationState ||
      (candidate.familyConfig !== null && !creation.staticAccounts.some((entry) => entry.address === candidate.familyConfig))) {
    betaError("PROGRAM_ABI_MISMATCH", "discovery capacity/binding relation mismatch", candidate.pool);
  }
  for (const account of creation.staticAccounts) {
    const fact = account.role === "token2022-mint" ? undefined : evidence.get(account.role);
    if (account.role === "token2022-mint") {
      if (candidate.token2022Mint !== account.address || candidate.adapterVersion !== 1) {
        betaError("PROGRAM_ABI_MISMATCH", "Token-2022 static role mismatch", account.address);
      }
      continue;
    }
    if (!fact || fact.address !== account.address) betaError("PROGRAM_ABI_MISMATCH", "creation account lacks capture evidence", account.address);
    const executable = account.role === "market-program" || (account.role === "open-orders" && account.address === "11111111111111111111111111111111");
    if ((fact.executable ?? false) !== executable) betaError("PROGRAM_ABI_MISMATCH", "creation account executable role mismatch", account.address);
  }
  const distinctAccounts = [...creation.staticAccounts.map((entry) => entry.address),
    ...(creation.observationState ? [creation.observationState] : [])];
  const zeroStatic = creation.staticAccounts.some((entry) => isZeroBytes(addressBytes(entry.address)) && entry.role !== "open-orders");
  if ((creation.adapterVersion === 1) !== (creation.token2022Mint !== null) ||
      (creation.adapterVersion === 1 && (candidate.token2022Mint === null || candidate.tokenProgramId !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID)) ||
      (candidate.family === "pumpswap" && creation.adapterVersion === 1 &&
        (candidate.token2022Mint !== candidate.baseMint || candidate.token2022PolicyHash !== null)) ||
      isZeroBytes(addressBytes(creation.tokenProgramId)) || isZeroBytes(addressBytes(creation.vaultAuthority)) || zeroStatic ||
      new Set(distinctAccounts).size !== distinctAccounts.length || creation.tokenProgramId === creation.vaultAuthority) {
    betaError("INVALID_ARGUMENT", "role-confusable creation binding", candidate.pool);
  }
  for (const [label, value] of Object.entries({
    operatorGroup: creation.operatorGroup, liquidityOwnerGroup: creation.liquidityOwnerGroup,
    quoteAssetGroup: creation.quoteAssetGroup, bridgeOrWrapperGroup: creation.bridgeOrWrapperGroup,
    oracleSourceClass: creation.oracleSourceClass, upgradeAuthorityGroup: creation.upgradeAuthorityGroup,
  })) safeU16(value, label);
}

function snapshotCreationBinding(input: MimirBetaPoolCreationBinding): MimirBetaPoolCreationBinding {
  if (!input || !Array.isArray(input.staticAccounts)) betaError("PROGRAM_ABI_MISMATCH", "creation binding shape invalid");
  const canonicalAddress = (value: Address, label: string): Address => {
    try { return bytesAddress(addressBytes(value)); }
    catch { return betaError("PROGRAM_ABI_MISMATCH", `${label} address invalid`); }
  };
  return Object.freeze({
    adapterType: input.adapterType,
    adapterVersion: input.adapterVersion,
    bindingVariant: input.bindingVariant,
    tokenProgramId: canonicalAddress(input.tokenProgramId, "token program"),
    token2022Mint: input.token2022Mint === null ? null : canonicalAddress(input.token2022Mint, "Token-2022 mint"),
    vaultAuthority: canonicalAddress(input.vaultAuthority, "vault authority"),
    staticAccounts: Object.freeze(input.staticAccounts.map((account) => Object.freeze({
      role: account.role,
      address: canonicalAddress(account.address, "static account"),
    }))),
    observationState: input.observationState === null ? null : canonicalAddress(input.observationState, "observation"),
    operatorGroup: input.operatorGroup,
    liquidityOwnerGroup: input.liquidityOwnerGroup,
    quoteAssetGroup: input.quoteAssetGroup,
    bridgeOrWrapperGroup: input.bridgeOrWrapperGroup,
    oracleSourceClass: input.oracleSourceClass,
    upgradeAuthorityGroup: input.upgradeAuthorityGroup,
  });
}

async function evidenceHash(args: {
  readonly cluster: MimirBetaCluster;
  readonly candidate: MimirBetaCaptureCandidate;
  readonly creation: MimirBetaPoolCreationBinding;
  readonly observedSlot: bigint;
  readonly validThroughSlot: bigint;
}): Promise<string> {
  const identity = {
    cluster: args.cluster,
    layoutHash: await layoutHash(args.candidate.family, args.cluster),
    family: args.candidate.family,
    descriptorId: args.candidate.descriptorId,
    descriptorHash: args.candidate.descriptorHash,
    readPlanHash: args.candidate.readPlanHash,
    programId: args.candidate.programId,
    pool: args.candidate.pool,
    baseMint: args.candidate.baseMint, quoteMint: args.candidate.quoteMint,
    canonicalMint0: args.candidate.canonicalMint0, canonicalMint1: args.candidate.canonicalMint1,
    canonicalPairKey: args.candidate.canonicalPairKey, direction: args.candidate.direction,
    baseVault: args.candidate.baseVault, quoteVault: args.candidate.quoteVault,
    adapterVersion: args.candidate.adapterVersion, token2022Mint: args.candidate.token2022Mint,
    token2022PolicyHash: args.candidate.token2022PolicyHash,
    minLiquidityNative: args.candidate.minLiquidityNative,
    minDepthTo50BpsNative: args.candidate.minDepthTo50BpsNative,
    capacityHash: args.candidate.capacityHash,
    capacityEvidence: args.candidate.capacityEvidence,
    creation: args.creation,
    observedSlot: args.observedSlot,
    validThroughSlot: args.validThroughSlot,
  };
  return domainHash("MIMIR_BETA_POOL_EVIDENCE_V1\0", canonicalJson(identity as never));
}

function validateSearchArgs(args: { baseMint: Address; quoteMint: Address; query: string; maxPools: number }): void {
  if (!Number.isInteger(args.maxPools) || args.maxPools < 1 || args.maxPools > 5) betaError("POOL_COUNT_OUT_OF_RANGE", "maxPools must be 1..5");
  if (args.baseMint === args.quoteMint || isZeroBytes(addressBytes(args.baseMint)) || isZeroBytes(addressBytes(args.quoteMint))) betaError("INVALID_ARGUMENT", "mint pair invalid");
  if (typeof args.query !== "string" || args.query !== args.query.trim()) betaError("INVALID_ARGUMENT", "query must be trimmed");
}

function canonicalAddress(value: unknown, label: string, code: "INVALID_ARGUMENT" | "ACCOUNT_MALFORMED" | "PROGRAM_ABI_MISMATCH" = "INVALID_ARGUMENT"): Address {
  if (typeof value !== "string") return betaError(code, `${label} address invalid`);
  try { return bytesAddress(addressBytes(value as Address)); }
  catch { return betaError(code, `${label} address invalid`); }
}

function exactKeys(value: unknown, expected: readonly string[], label: string, code: "INVALID_ARGUMENT" | "ACCOUNT_MALFORMED" = "INVALID_ARGUMENT"): void {
  if (!value || typeof value !== "object") betaError(code, `${label} shape invalid`);
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== [...expected].sort()[index])) {
    betaError(code, `${label} shape invalid`);
  }
}

function dataRecord(input: unknown, expected: readonly string[], label: string): Record<string, unknown> {
  if (!input || typeof input !== "object" || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null) ||
      Object.getOwnPropertySymbols(input).length !== 0) betaError("INVALID_ARGUMENT", `${label} record invalid`);
  exactKeys(input, expected, label);
  const output: Record<string, unknown> = {};
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) betaError("INVALID_ARGUMENT", `${label} contains an accessor`);
    output[key] = descriptor.value;
  }
  return output;
}

function denseArrayValues(input: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(input) || Object.getPrototypeOf(input) !== Array.prototype || Object.getOwnPropertySymbols(input).length !== 0) {
    betaError("INVALID_ARGUMENT", `${label} must be a standard array`);
  }
  const names = Object.getOwnPropertyNames(input);
  if (names.length !== input.length + 1) betaError("INVALID_ARGUMENT", `${label} must be dense and non-exotic`);
  const values: unknown[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) betaError("INVALID_ARGUMENT", `${label} contains an accessor or hole`);
    values.push(descriptor.value);
  }
  return Object.freeze(values);
}

interface SnapshotBounds {
  readonly maxDepth: number;
  readonly maxObjects: number;
  readonly maxProperties: number;
  readonly maxArrayLength: number;
  readonly maxArrayItems: number;
  readonly maxByteLength: number;
  readonly maxTotalBytes: number;
  readonly maxTotalStringChars?: number;
}

const typedArrayByteLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), "byteLength")?.get;
const proxyRejectingStructuredClone: ((value: unknown) => unknown) | null = (() => {
  const clone = globalThis.structuredClone;
  if (typeof clone !== "function") return null;
  try {
    const ordinary = clone.call(globalThis, Object.freeze({ bytes: Uint8Array.of(7), values: Object.freeze([1n]) })) as
      Readonly<{ bytes?: Uint8Array; values?: readonly bigint[] }>;
    if (!(ordinary.bytes instanceof Uint8Array) || ordinary.bytes[0] !== 7 || ordinary.values?.[0] !== 1n) return null;
  } catch {
    return null;
  }
  try {
    clone.call(globalThis, new Proxy({}, {}));
    return null;
  } catch {
    return (value: unknown): unknown => clone.call(globalThis, value);
  }
})();

function admitBoundedSnapshotGraph(input: unknown, label: string, bounds: SnapshotBounds, requireProxyOracle = true): void {
  const proxyOracle = requireProxyOracle ? proxyRejectingStructuredClone : null;
  if (requireProxyOracle && !proxyOracle) betaError("INVALID_ARGUMENT", `${label} cannot be admitted safely in this environment`);
  let objects = 0; let properties = 0; let arrayItems = 0; let totalBytes = 0; let totalStringChars = 0;
  const active = new Set<object>();
  const rejectProxy = (object: object): void => {
    try { proxyOracle!(object); }
    catch { betaError("INVALID_ARGUMENT", `${label} contains a Proxy or unsupported value`); }
  };
  const visit = (value: unknown, depth: number): void => {
    if (typeof value === "string") {
      totalStringChars += value.length;
      if (totalStringChars > (bounds.maxTotalStringChars ?? Number.MAX_SAFE_INTEGER)) {
        betaError("INVALID_ARGUMENT", `${label} exceeds its string bounds`);
      }
      return;
    }
    if (value === null || typeof value === "boolean" || typeof value === "bigint" ||
        (typeof value === "number" && Number.isFinite(value))) return;
    if (typeof value !== "object" || depth > bounds.maxDepth) {
      betaError("INVALID_ARGUMENT", `${label} exceeds its structural bounds`);
    }
    const object = value as object;
    objects += 1;
    if (objects > bounds.maxObjects || active.has(object)) betaError("INVALID_ARGUMENT", `${label} exceeds its structural bounds`);
    active.add(object);
    try {
      const prototype = Object.getPrototypeOf(object);
      if (prototype === Uint8Array.prototype) {
        let byteLength: number;
        try {
          if (!typedArrayByteLength) throw new TypeError("missing typed-array byte-length intrinsic");
          byteLength = typedArrayByteLength.call(object) as number;
        } catch {
          return betaError("INVALID_ARGUMENT", `${label} contains proxied or invalid bytes`);
        }
        totalBytes += byteLength;
        if (byteLength > bounds.maxByteLength || totalBytes > bounds.maxTotalBytes) {
          betaError("INVALID_ARGUMENT", `${label} exceeds its byte bounds`);
        }
        const names = Object.getOwnPropertyNames(object);
        if (Object.getOwnPropertySymbols(object).length !== 0 || names.length !== byteLength) {
          betaError("INVALID_ARGUMENT", `${label} contains exotic bytes`);
        }
        if (proxyOracle) rejectProxy(object);
        return;
      }
      if (Array.isArray(object)) {
        if (prototype !== Array.prototype || Object.getOwnPropertySymbols(object).length !== 0) {
          betaError("INVALID_ARGUMENT", `${label} contains an exotic array`);
        }
        const lengthDescriptor = Object.getOwnPropertyDescriptor(object, "length");
        if (!lengthDescriptor || !("value" in lengthDescriptor) || !Number.isSafeInteger(lengthDescriptor.value) || lengthDescriptor.value < 0) {
          betaError("INVALID_ARGUMENT", `${label} contains an invalid array`);
        }
        const length = lengthDescriptor.value as number;
        arrayItems += length;
        if (length > bounds.maxArrayLength || arrayItems > bounds.maxArrayItems) {
          betaError("INVALID_ARGUMENT", `${label} exceeds its array bounds`);
        }
        const names = Object.getOwnPropertyNames(object);
        if (names.length !== length + 1) betaError("INVALID_ARGUMENT", `${label} contains a sparse or exotic array`);
        for (let index = 0; index < length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            betaError("INVALID_ARGUMENT", `${label} contains an accessor or sparse array`);
          }
          visit(descriptor.value, depth + 1);
        }
        if (proxyOracle) rejectProxy(object);
        return;
      }
      if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(object).length !== 0) {
        betaError("INVALID_ARGUMENT", `${label} contains an unsupported object`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(object);
      if (Object.keys(descriptors).some((key) => key === "__proto__" || key === "prototype" || key === "constructor")) {
        betaError("INVALID_ARGUMENT", `${label} contains a dangerous key`);
      }
      properties += Object.keys(descriptors).length;
      if (properties > bounds.maxProperties) betaError("INVALID_ARGUMENT", `${label} exceeds its property bounds`);
      for (const descriptor of Object.values(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable) {
          betaError("INVALID_ARGUMENT", `${label} contains an accessor or hidden field`);
        }
        visit(descriptor.value, depth + 1);
      }
      if (proxyOracle) rejectProxy(object);
    } finally {
      active.delete(object);
    }
  };
  visit(input, 0);
}

function strictSnapshot<T>(input: T, label: string, bounds: SnapshotBounds): T {
  admitBoundedSnapshotGraph(input, label, bounds);
  const active = new Set<object>();
  const clone = (value: unknown): unknown => {
    if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "bigint" ||
        (typeof value === "number" && Number.isFinite(value))) return value;
    if (typeof value !== "object") betaError("INVALID_ARGUMENT", `${label} contains an unsupported value`);
    const object = value as object;
    if (active.has(object)) betaError("INVALID_ARGUMENT", `${label} contains a cycle`);
    active.add(object);
    try {
      if (Object.getPrototypeOf(object) === Uint8Array.prototype) {
        const byteLength = (object as Uint8Array).length;
        const names = Object.getOwnPropertyNames(object);
        if (Object.getOwnPropertySymbols(object).length !== 0 || names.length !== byteLength || names.some((name) =>
          !/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= byteLength)) {
          betaError("INVALID_ARGUMENT", `${label} contains exotic bytes`);
        }
        const bytes = Uint8Array.prototype.slice.call(object) as Uint8Array;
        return bytes;
      }
      if (Array.isArray(object)) {
        if (Object.getPrototypeOf(object) !== Array.prototype || Object.getOwnPropertySymbols(object).length !== 0) {
          betaError("INVALID_ARGUMENT", `${label} contains an exotic array`);
        }
        const array = object as unknown[];
        const names = Object.getOwnPropertyNames(object);
        if (names.length !== array.length + 1 || names.some((name) => name !== "length" &&
            (!/^(0|[1-9][0-9]*)$/.test(name) || Number(name) >= array.length))) {
          betaError("INVALID_ARGUMENT", `${label} contains a sparse or exotic array`);
        }
        const output: unknown[] = [];
        for (let index = 0; index < array.length; index += 1) {
          const descriptor = Object.getOwnPropertyDescriptor(object, String(index));
          if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
            betaError("INVALID_ARGUMENT", `${label} contains an accessor or sparse array`);
          }
          output.push(clone(descriptor.value));
        }
        return Object.freeze(output);
      }
      const prototype = Object.getPrototypeOf(object);
      if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(object).length !== 0) {
        betaError("INVALID_ARGUMENT", `${label} contains an unsupported object`);
      }
      const descriptors = Object.getOwnPropertyDescriptors(object);
      const output: Record<string, unknown> = {};
      for (const [key, descriptor] of Object.entries(descriptors)) {
        if (!("value" in descriptor) || !descriptor.enumerable) betaError("INVALID_ARGUMENT", `${label} contains an accessor or hidden field`);
        output[key] = clone(descriptor.value);
      }
      return Object.freeze(output);
    } finally {
      active.delete(object);
    }
  };
  return clone(input) as T;
}

function parsedSnapshot(input: unknown, label: string, bounds: SnapshotBounds): unknown {
  admitBoundedSnapshotGraph(input, label, bounds, false);
  const detach = (value: unknown): unknown => {
    if (!value || typeof value !== "object") return value;
    if (value instanceof Uint8Array) return Uint8Array.from(value);
    if (Array.isArray(value)) return value.map(detach);
    return Object.fromEntries(Object.entries(value).map(([key, member]) => [key, detach(member)]));
  };
  return detach(input);
}

function deepFreeze<T>(input: T): T {
  if (!input || typeof input !== "object" || input instanceof Uint8Array) return input;
  for (const value of Object.values(input)) deepFreeze(value);
  return Object.freeze(input);
}

function parseSerialized(input: string, label: string, maxChars: number, bounds: SnapshotBounds): unknown {
  if (input.length === 0 || input.length > maxChars) betaError("INVALID_ARGUMENT", `${label} exceeds its raw bounds`);
  let parsed: unknown;
  try { parsed = JSON.parse(input); }
  catch { return betaError("INVALID_ARGUMENT", `${label} is not valid JSON`); }
  return parsedSnapshot(parsed, label, bounds);
}

function decodeUintBigint(value: unknown, label: string): bigint {
  if (typeof value !== "string" || value.length > 78 || !/^(0|[1-9][0-9]*)$/.test(value)) {
    return betaError("INVALID_ARGUMENT", `${label} must be an unsigned decimal string`);
  }
  return BigInt(value);
}

function decodeUintNumber(value: unknown, label: string): number {
  const integer = decodeUintBigint(value, label);
  if (integer > BigInt(Number.MAX_SAFE_INTEGER)) betaError("INVALID_ARGUMENT", `${label} exceeds safe integer range`);
  return Number(integer);
}

function decodeBytes(value: unknown, label: string, maxBytes: number): Uint8Array {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(maxBytes / 3)) {
    return betaError("INVALID_ARGUMENT", `${label} exceeds its byte bounds`);
  }
  const bytes = fromBase64(value);
  if (bytes.length > maxBytes) betaError("INVALID_ARGUMENT", `${label} exceeds its byte bounds`);
  return Uint8Array.from(bytes);
}

function decodeLayouts(input: string): readonly PoolCoreLayout[] {
  const parsed = parseSerialized(input, "discovery source layouts", 16_384, {
    maxDepth: 3, maxObjects: 13, maxProperties: 75, maxArrayLength: 3, maxArrayItems: 6,
    maxByteLength: 0, maxTotalBytes: 0, maxTotalStringChars: 12_288,
  });
  if (!Array.isArray(parsed)) betaError("INVALID_ARGUMENT", "discovery source layouts shape invalid");
  const layouts = parsed.map((value, index) => {
    if (!value || typeof value !== "object") return betaError("INVALID_ARGUMENT", "discovery source layout shape invalid");
    const layout = value as Record<string, unknown>;
    const required = ["accountSize", "discriminator", "discriminatorOffset", "family", "mintAOffset", "mintBOffset", "programId", "vaultAOffset", "vaultBOffset"];
    const optional = ["activation", "liquidityOffset", "status"];
    const keys = Object.keys(layout);
    if (required.some((key) => !keys.includes(key)) || keys.some((key) => !required.includes(key) && !optional.includes(key))) {
      return betaError("INVALID_ARGUMENT", "discovery source layout shape invalid");
    }
    for (const key of ["accountSize", "discriminatorOffset", "mintAOffset", "mintBOffset", "vaultAOffset", "vaultBOffset", "liquidityOffset"]) {
      if (layout[key] !== undefined) layout[key] = decodeUintNumber(layout[key], `layout ${index} ${key}`);
    }
    layout.discriminator = layout.discriminator === null ? null : decodeBytes(layout.discriminator, `layout ${index} discriminator`, 8);
    if (layout.status !== undefined) {
      if (!layout.status || typeof layout.status !== "object") return betaError("INVALID_ARGUMENT", "layout status shape invalid");
      const status = layout.status as Record<string, unknown>;
      const statusKeys = Object.keys(status);
      if (!statusKeys.includes("offset") || statusKeys.some((key) => !["offset", "enabled", "disabledMask", "acceptedU64"].includes(key))) {
        return betaError("INVALID_ARGUMENT", "layout status shape invalid");
      }
      for (const key of ["offset", "enabled", "disabledMask"]) if (status[key] !== undefined) status[key] = decodeUintNumber(status[key], `layout status ${key}`);
      if (status.acceptedU64 !== undefined) {
        if (!Array.isArray(status.acceptedU64)) return betaError("INVALID_ARGUMENT", "layout accepted status shape invalid");
        status.acceptedU64 = status.acceptedU64.map((entry) => decodeUintBigint(entry, "layout accepted status"));
      }
    }
    if (layout.activation !== undefined) {
      if (!layout.activation || typeof layout.activation !== "object") return betaError("INVALID_ARGUMENT", "layout activation shape invalid");
      const activation = layout.activation as Record<string, unknown>;
      const activationKeys = Object.keys(activation);
      if (!activationKeys.includes("offset") || activationKeys.some((key) => !["offset", "typeOffset", "slotType", "timestampType"].includes(key))) {
        return betaError("INVALID_ARGUMENT", "layout activation shape invalid");
      }
      for (const key of activationKeys) activation[key] = decodeUintNumber(activation[key], `layout activation ${key}`);
    }
    return layout as unknown as PoolCoreLayout;
  });
  return deepFreeze(layouts);
}

function decodeAccounts(input: string, label: string, maxChars: number, maxRows: number, maxBytes: number,
  captured: false): readonly PoolCoreAccount[];
function decodeAccounts(input: string, label: string, maxChars: number, maxRows: number, maxBytes: number,
  captured: true): Readonly<{ contextSlot: bigint; accounts: readonly MimirBetaCapturedAccount[] }>;
function decodeAccounts(input: string, label: string, maxChars: number, maxRows: number, maxBytes: number, captured: boolean): unknown {
  const parsed = parseSerialized(input, label, maxChars, {
    maxDepth: 3, maxObjects: 2 + maxRows * 2, maxProperties: 2 + maxRows * 4,
    maxArrayLength: maxRows, maxArrayItems: maxRows, maxByteLength: 0, maxTotalBytes: 0, maxTotalStringChars: maxChars,
  });
  const rows = captured ? (parsed as Record<string, unknown>)?.accounts : parsed;
  if (captured) {
    exactKeys(parsed, ["accounts", "contextSlot"], label);
    (parsed as Record<string, unknown>).contextSlot = decodeUintBigint((parsed as Record<string, unknown>).contextSlot, `${label} contextSlot`);
  }
  if (!Array.isArray(rows) || rows.length > maxRows) betaError("ACCOUNT_MALFORMED", `${label} invalid`);
  let totalBytes = 0;
  for (const raw of rows) {
    exactKeys(raw, captured ? ["address", "data", "executable", "owner"] : ["address", "data", "owner"], `${label} row`, "ACCOUNT_MALFORMED");
    const row = raw as Record<string, unknown>;
    row.data = decodeBytes(row.data, `${label} row data`, maxBytes); totalBytes += (row.data as Uint8Array).length;
    if (totalBytes > maxRows * maxBytes || (captured && typeof row.executable !== "boolean")) betaError("ACCOUNT_MALFORMED", `${label} invalid`);
  }
  return deepFreeze(parsed);
}

function decodeEligiblePools(parsed: unknown): Readonly<{ pools: readonly MimirBetaEligiblePool[]; minContextSlot: bigint; maxConfidenceBps?: number }> {
  const hasMaxConfidenceBps = parsed !== null && typeof parsed === "object" &&
    Object.prototype.hasOwnProperty.call(parsed, "maxConfidenceBps");
  exactKeys(parsed, hasMaxConfidenceBps ? ["maxConfidenceBps", "minContextSlot", "pools"] : ["minContextSlot", "pools"],
    "pool revalidation arguments");
  const args = parsed as Record<string, unknown>;
  if (!Array.isArray(args.pools) || args.pools.length < 1 || args.pools.length > 5) betaError("POOL_COUNT_OUT_OF_RANGE", "selected pools must total 1..5");
  args.minContextSlot = decodeUintBigint(args.minContextSlot, "minimum context slot");
  if (hasMaxConfidenceBps) args.maxConfidenceBps = decodeUintNumber(args.maxConfidenceBps, "maxConfidenceBps");
  for (const raw of args.pools) {
    exactKeys(raw, eligibleKeys(raw), "selected pool");
    const pool = raw as Record<string, unknown>;
    pool.adapterVersion = decodeUintNumber(pool.adapterVersion, "selected pool adapterVersion");
    pool.token2022Mint = pool.token2022Mint === null ? null : canonicalAddress(pool.token2022Mint, "selected pool Token-2022 mint");
    for (const key of ["minDepthTo50BpsNative", "minLiquidityNative", "observedSlot", "validThroughSlot",
      ...("boostVaultLamports" in pool ? ["boostVaultLamports", "maxBoostDriftBps"] : [])]) pool[key] = decodeUintBigint(pool[key], `selected pool ${key}`);
    if ("pumpSwapBaseIsA" in pool && typeof pool.pumpSwapBaseIsA !== "boolean") betaError("INVALID_ARGUMENT", "selected pool pumpSwapBaseIsA must be boolean");
    exactKeys(pool.readPlan, PLAN_KEYS, "selected read plan");
    const plan = pool.readPlan as Record<string, unknown>;
    exactKeys(plan.context, ["observedSlot", "observedUnixTimestamp"], "selected read plan context");
    const context = plan.context as Record<string, unknown>;
    context.observedSlot = decodeUintBigint(context.observedSlot, "selected read plan observed slot");
    context.observedUnixTimestamp = decodeUintBigint(context.observedUnixTimestamp, "selected read plan observed timestamp");
    if (!Array.isArray(plan.auxiliary)) betaError("INVALID_ARGUMENT", "selected read plan nodes invalid");
    for (const node of plan.auxiliary) exactKeys(node, ["address", "derivedFrom", "index", "role"], "selected read plan node");
    exactKeys(pool.creation, CREATION_KEYS, "selected creation binding");
    const creation = pool.creation as Record<string, unknown>;
    for (const key of ["adapterType", "adapterVersion", "operatorGroup", "liquidityOwnerGroup", "quoteAssetGroup", "bridgeOrWrapperGroup", "oracleSourceClass", "upgradeAuthorityGroup"]) {
      creation[key] = decodeUintNumber(creation[key], `selected creation ${key}`);
    }
    creation.token2022Mint = creation.token2022Mint === null ? null : canonicalAddress(creation.token2022Mint, "selected creation Token-2022 mint");
    if (!Array.isArray(creation.staticAccounts)) betaError("INVALID_ARGUMENT", "selected creation static accounts invalid");
    for (const account of creation.staticAccounts) exactKeys(account, ["address", "role"], "selected creation static account");
  }
  return deepFreeze(args) as unknown as Readonly<{ pools: readonly MimirBetaEligiblePool[]; minContextSlot: bigint }>;
}

function snapshotSearchArgs(input: MimirBetaPoolSearchArgs | string) {
  const snapshot = typeof input === "string" ? parseSerialized(input, "pool search arguments", 2_048, {
    maxDepth: 1, maxObjects: 1, maxProperties: 4, maxArrayLength: 0, maxArrayItems: 0, maxByteLength: 0, maxTotalBytes: 0,
    maxTotalStringChars: 1_024,
  }) as MimirBetaPoolSearchArgs : strictSnapshot(input, "pool search arguments", {
    maxDepth: 1, maxObjects: 1, maxProperties: 4, maxArrayLength: 0, maxArrayItems: 0, maxByteLength: 0, maxTotalBytes: 0,
  });
  exactKeys(snapshot, ["baseMint", "maxPools", "query", "quoteMint"], "pool search arguments");
  const args = Object.freeze({ baseMint: canonicalAddress(snapshot.baseMint, "base mint"),
    quoteMint: canonicalAddress(snapshot.quoteMint, "quote mint"), query: snapshot.query,
    maxPools: typeof input === "string" ? decodeUintNumber(snapshot.maxPools, "maxPools") as MimirBetaCount : snapshot.maxPools });
  validateSearchArgs(args);
  return args;
}

function snapshotContext(input: unknown): Readonly<{ slot: bigint; unixTimestamp: bigint }> {
  const context = (typeof input === "string" ? parseSerialized(input, "RPC context", 256, {
    maxDepth: 1, maxObjects: 1, maxProperties: 2, maxArrayLength: 0, maxArrayItems: 0, maxByteLength: 0, maxTotalBytes: 0,
    maxTotalStringChars: 192,
  }) : strictSnapshot(input, "RPC context", {
    maxDepth: 1, maxObjects: 1, maxProperties: 2, maxArrayLength: 0, maxArrayItems: 0, maxByteLength: 0, maxTotalBytes: 0,
  })) as Record<string, unknown>;
  exactKeys(context, ["slot", "unixTimestamp"], "RPC context");
  if (typeof input === "string") {
    context.slot = decodeUintBigint(context.slot, "RPC context slot");
    context.unixTimestamp = decodeUintBigint(context.unixTimestamp, "RPC context timestamp");
  }
  if (typeof context.slot !== "bigint" || context.slot < 0n || typeof context.unixTimestamp !== "bigint" || context.unixTimestamp < 0n) {
    betaError("RPC_CONTEXT_MISMATCH", "discovery context is invalid");
  }
  return Object.freeze({ slot: context.slot, unixTimestamp: context.unixTimestamp });
}

const ELIGIBLE_KEYS = ["adapterVersion", "baseMint", "baseVault", "canonicalMint0", "canonicalMint1", "canonicalPairKey", "creation", "descriptorHash",
  "descriptorId", "direction", "eligibility", "evidenceHash", "family", "minDepthTo50BpsNative", "minLiquidityNative", "observedSlot",
  "pool", "programId", "quoteMint", "quoteVault", "readPlan", "token2022Mint", "token2022PolicyHash", "validThroughSlot"] as const;
const eligibleKeys = (pool: unknown): readonly string[] => [...ELIGIBLE_KEYS,
  ...(pool && typeof pool === "object" && "pointOnly" in pool ? ["pointOnly"] : []),
  ...(pool && typeof pool === "object" && "boostVaultLamports" in pool ? ["boostVaultLamports", "maxBoostDriftBps", "pumpSwapBaseIsA"] : [])];
const PLAN_KEYS = ["allAddresses", "auxiliary", "baseMint", "baseVault", "canonicalMint0", "canonicalMint1", "canonicalPairKey", "context",
  "descriptorHash", "descriptorId", "direction", "family", "planHash", "pool", "primaryDataSha256", "program", "quoteMint", "quoteVault", "schema"] as const;
const CREATION_KEYS = ["adapterType", "adapterVersion", "bindingVariant", "bridgeOrWrapperGroup", "liquidityOwnerGroup",
  "observationState", "operatorGroup", "oracleSourceClass", "quoteAssetGroup", "staticAccounts", "token2022Mint", "tokenProgramId", "upgradeAuthorityGroup", "vaultAuthority"] as const;
// Largest account allocation admitted by the supported capacity decoders (Raydium CLMM tick array).
const MAX_CAPTURE_ACCOUNT_BYTES = 10_240;

function snapshotRevalidationArgs(input: MimirBetaPoolRevalidationArgs | string): Readonly<{
  pools: readonly MimirBetaEligiblePool[]; minContextSlot: bigint; maxConfidenceBps?: number;
}> {
  if (typeof input === "string") {
    const parsed = parseSerialized(input, "pool revalidation arguments", 65_536, {
      maxDepth: 6, maxObjects: 152, maxProperties: 527, maxArrayLength: 10, maxArrayItems: 170,
      maxByteLength: 0, maxTotalBytes: 0, maxTotalStringChars: 60_000,
    });
    const decoded = decodeEligiblePools(parsed);
    return validateRevalidationSnapshot(decoded);
  }
  if (!input || typeof input !== "object") betaError("INVALID_ARGUMENT", "pool revalidation arguments invalid");
  const poolsDescriptor = Object.getOwnPropertyDescriptor(input, "pools");
  if (!poolsDescriptor || !("value" in poolsDescriptor) || !Array.isArray(poolsDescriptor.value)) {
    betaError("INVALID_ARGUMENT", "pool revalidation arguments invalid");
  }
  const poolLength = Object.getOwnPropertyDescriptor(poolsDescriptor.value, "length")?.value;
  if (!Number.isSafeInteger(poolLength) || poolLength < 1 || poolLength > 5) {
    betaError("POOL_COUNT_OUT_OF_RANGE", "selected pools must total 1..5");
  }
  const args = strictSnapshot(input, "pool revalidation arguments", {
    maxDepth: 6, maxObjects: 152, maxProperties: 527, maxArrayLength: 10, maxArrayItems: 170,
    maxByteLength: 0, maxTotalBytes: 0,
  });
  return validateRevalidationSnapshot(args);
}

function validateRevalidationSnapshot(args: Readonly<{ pools: readonly MimirBetaEligiblePool[]; minContextSlot: bigint; maxConfidenceBps?: number }>): Readonly<{
  pools: readonly MimirBetaEligiblePool[]; minContextSlot: bigint; maxConfidenceBps?: number;
}> {
  const hasMaxConfidenceBps = Object.prototype.hasOwnProperty.call(args, "maxConfidenceBps");
  exactKeys(args, hasMaxConfidenceBps ? ["maxConfidenceBps", "minContextSlot", "pools"] : ["minContextSlot", "pools"],
    "pool revalidation arguments");
  if (typeof args.minContextSlot !== "bigint" || args.minContextSlot < 0n || !Array.isArray(args.pools)) {
    betaError("INVALID_ARGUMENT", "pool revalidation arguments invalid");
  }
  if (hasMaxConfidenceBps && (typeof args.maxConfidenceBps !== "number" || !Number.isInteger(args.maxConfidenceBps) ||
      args.maxConfidenceBps < 1 || args.maxConfidenceBps > 9_999)) {
    betaError("INVALID_ARGUMENT", "maxConfidenceBps must be an integer from 1..9999");
  }
  for (const pool of args.pools as readonly MimirBetaEligiblePool[]) {
    if (!pool || typeof pool !== "object") betaError("INVALID_ARGUMENT", "selected pool shape invalid");
    exactKeys(pool, eligibleKeys(pool), "selected pool");
    if ("pointOnly" in pool && (pool.pointOnly !== true || (FAMILY[pool.family]?.adapterType !== 4 && FAMILY[pool.family]?.adapterType !== 6))) {
      betaError("INVALID_ARGUMENT", "selected pool pointOnly invalid");
    }
    if (pool.eligibility !== "eligible" || !FAMILY[pool.family] || pool.direction !== "quote-per-base" ||
        !sourceAdapterSupportsVersion(FAMILY[pool.family].adapterType, pool.adapterVersion) ||
        (pool.token2022Mint !== null && canonicalAddress(pool.token2022Mint, "selected pool Token-2022 mint") !== pool.token2022Mint) ||
        ((pool.family === "raydium-clmm" || pool.family === "meteora-dlmm") && pool.adapterVersion === 1
          ? typeof pool.token2022PolicyHash !== "string" || !/^[0-9a-f]{64}$/.test(pool.token2022PolicyHash)
          : pool.token2022PolicyHash !== null) ||
        typeof pool.canonicalPairKey !== "string" || !/^[0-9a-f]{64}$/.test(pool.descriptorHash) || typeof pool.descriptorId !== "string" ||
        !/^[0-9a-f]{64}$/.test(pool.evidenceHash) || typeof pool.minLiquidityNative !== "bigint" || pool.minLiquidityNative < 0n ||
        typeof pool.minDepthTo50BpsNative !== "bigint" || pool.minDepthTo50BpsNative < 0n || typeof pool.observedSlot !== "bigint" ||
        pool.observedSlot < 0n || typeof pool.validThroughSlot !== "bigint" || pool.validThroughSlot < pool.observedSlot) {
      betaError("INVALID_ARGUMENT", "selected pool fields invalid");
    }
    for (const [label, value] of Object.entries({ program: pool.programId, pool: pool.pool, baseMint: pool.baseMint, quoteMint: pool.quoteMint,
      canonicalMint0: pool.canonicalMint0, canonicalMint1: pool.canonicalMint1, baseVault: pool.baseVault, quoteVault: pool.quoteVault })) {
      if (canonicalAddress(value, label) !== value) betaError("INVALID_ARGUMENT", `${label} address is not canonical`);
    }
    const plan = pool.readPlan;
    if (!plan || typeof plan !== "object") betaError("INVALID_ARGUMENT", "selected read plan shape invalid");
    exactKeys(plan, PLAN_KEYS, "selected read plan");
    if (plan.schema !== "mimir-beta-capture-read-plan-v1" || !FAMILY[plan.family] || plan.direction !== "quote-per-base" ||
        typeof plan.descriptorId !== "string" || !/^[0-9a-f]{64}$/.test(plan.descriptorHash) || typeof plan.canonicalPairKey !== "string" ||
        !/^[0-9a-f]{64}$/.test(plan.primaryDataSha256) || !/^[0-9a-f]{64}$/.test(plan.planHash) || !Array.isArray(plan.auxiliary) ||
        !Array.isArray(plan.allAddresses)) {
      betaError("INVALID_ARGUMENT", "selected read plan fields invalid");
    }
    exactKeys(plan.context, ["observedSlot", "observedUnixTimestamp"], "selected read plan context");
    if (typeof plan.context.observedSlot !== "bigint" || plan.context.observedSlot < 0n ||
        typeof plan.context.observedUnixTimestamp !== "bigint" || plan.context.observedUnixTimestamp < 0n) {
      betaError("INVALID_ARGUMENT", "selected read plan context invalid");
    }
    for (const node of plan.auxiliary) {
      exactKeys(node, ["address", "derivedFrom", "index", "role"], "selected read plan node");
      if (typeof node.role !== "string" || (node.index !== null && typeof node.index !== "string") || !Array.isArray(node.derivedFrom)) {
        betaError("INVALID_ARGUMENT", "selected read plan node invalid");
      }
      canonicalAddress(node.address, "read plan node");
      (node.derivedFrom as readonly Address[]).forEach((address) => canonicalAddress(address, "read plan derivation"));
    }
    plan.allAddresses.forEach((address) => canonicalAddress(address, "read plan account"));
    for (const value of [plan.program, plan.pool, plan.baseMint, plan.quoteMint, plan.canonicalMint0, plan.canonicalMint1, plan.baseVault, plan.quoteVault]) {
      canonicalAddress(value, "read plan");
    }
    const creation = pool.creation;
    exactKeys(creation, CREATION_KEYS, "selected creation binding");
    snapshotCreationBinding(creation);
    if (![0, 1, 2, 3, 4, 6, 7].includes(creation.adapterType) || !sourceAdapterSupportsVersion(creation.adapterType, creation.adapterVersion) ||
        (creation.adapterType !== 1 && creation.adapterType !== 3 && !(creation.adapterType === 6 && creation.adapterVersion === 1) && creation.adapterVersion !== 0) ||
        ((creation.adapterVersion === 1) !== (creation.token2022Mint !== null)) ||
        (creation.token2022Mint !== null && canonicalAddress(creation.token2022Mint, "selected creation Token-2022 mint") !== creation.token2022Mint) ||
        !(creation.bindingVariant === "direct" || creation.bindingVariant === "routeable") || !Array.isArray(creation.staticAccounts)) {
      betaError("INVALID_ARGUMENT", "selected creation binding fields invalid");
    }
    for (const account of creation.staticAccounts) {
      exactKeys(account, ["address", "role"], "selected creation static account");
      if (typeof account.role !== "string") betaError("INVALID_ARGUMENT", "selected creation static account invalid");
      canonicalAddress(account.address, "selected creation static account");
    }
    if (pool.adapterVersion !== creation.adapterVersion || pool.token2022Mint !== creation.token2022Mint ||
        (pool.adapterVersion === 1 && pool.family !== "raydium-clmm" && pool.family !== "meteora-dlmm" && pool.family !== "pumpswap") ||
        (pool.adapterVersion === 1 && pool.family === "pumpswap" &&
          (pool.token2022Mint !== pool.baseMint || pool.token2022PolicyHash !== null))) {
      betaError("INVALID_ARGUMENT", "selected pool/version binding differs");
    }
    for (const [label, value] of Object.entries({ operatorGroup: creation.operatorGroup, liquidityOwnerGroup: creation.liquidityOwnerGroup,
      quoteAssetGroup: creation.quoteAssetGroup, bridgeOrWrapperGroup: creation.bridgeOrWrapperGroup,
      oracleSourceClass: creation.oracleSourceClass, upgradeAuthorityGroup: creation.upgradeAuthorityGroup })) safeU16(value, label);
  }
  validateSelectedPools(args.pools, args.minContextSlot);
  return Object.freeze({ pools: args.pools, minContextSlot: args.minContextSlot,
    ...(hasMaxConfidenceBps ? { maxConfidenceBps: args.maxConfidenceBps as number } : {}) });
}

type AdmittedDiscoverySource = Readonly<{
  layouts: readonly PoolCoreLayout[];
  loadProgram: MimirBetaPoolDiscoverySource["loadProgram"];
  scan: MimirBetaPoolDiscoverySource["scan"];
}>;

function canonicalLayoutsForFamily(family: MimirBetaSourceFamily, cluster: MimirBetaCluster): readonly PoolCoreLayout[] {
  const expected = mimirBetaCaptureScanDescriptors(cluster).filter((descriptor) => descriptor.family === family)
    .map(mimirBetaCapturePoolCoreLayout).sort((left, right) => left.accountSize - right.accountSize);
  return deepFreeze(parsedSnapshot(expected, "canonical discovery source layouts", {
    maxDepth: 3, maxObjects: 13, maxProperties: 75, maxArrayLength: 3, maxArrayItems: 6,
    maxByteLength: 8, maxTotalBytes: 24,
  }) as readonly PoolCoreLayout[]);
}

export function createInjectedPoolDiscovery(config: CreateInjectedPoolDiscoveryConfig): MimirBetaInjectedPoolDiscovery {
  const hasMaxConfidenceBps = config !== null && typeof config === "object" && Object.prototype.hasOwnProperty.call(config, "maxConfidenceBps");
  const hasExistingFeed = config !== null && typeof config === "object" && Object.prototype.hasOwnProperty.call(config, "existingFeed");
  const configValues = dataRecord(config, ["cluster", "evidenceTtlSlots", "getContext", "loadCapturePlanAccounts", "maxScanResultsPerFamily",
    ...(hasMaxConfidenceBps ? ["maxConfidenceBps"] : []), ...(hasExistingFeed ? ["existingFeed"] : []), "sources"], "discovery config");
  if (hasExistingFeed && configValues.existingFeed !== true) betaError("INVALID_ARGUMENT", "discovery existingFeed must be true when present");
  const existingFeed = hasExistingFeed;
  const cluster = configValues.cluster as MimirBetaCluster; const evidenceTtlSlots = configValues.evidenceTtlSlots as bigint;
  const maxScanResultsPerFamily = configValues.maxScanResultsPerFamily as number;
  const maxConfidenceBps = configValues.maxConfidenceBps;
  if (hasMaxConfidenceBps && (typeof maxConfidenceBps !== "number" || !Number.isInteger(maxConfidenceBps) || maxConfidenceBps < 1 || maxConfidenceBps > 9_999)) {
    betaError("INVALID_ARGUMENT", "discovery maxConfidenceBps out of range");
  }
  const sourceInputs = denseArrayValues(configValues.sources, "discovery sources");
  const getContext = configValues.getContext as CreateInjectedPoolDiscoveryConfig["getContext"];
  const loadCapturePlanAccounts = configValues.loadCapturePlanAccounts as CreateInjectedPoolDiscoveryConfig["loadCapturePlanAccounts"];
  if (!(cluster === "localnet" || cluster === "devnet" || cluster === "mainnet-beta") || typeof evidenceTtlSlots !== "bigint" ||
    evidenceTtlSlots < 0n || !Array.isArray(sourceInputs) || Object.getPrototypeOf(sourceInputs) !== Array.prototype ||
    sourceInputs.length < 1 || sourceInputs.length > 7 || typeof getContext !== "function" || typeof loadCapturePlanAccounts !== "function" ||
    !Number.isSafeInteger(maxScanResultsPerFamily) || maxScanResultsPerFamily < 1) {
    betaError("INVALID_ARGUMENT", "discovery bounds invalid");
  }
  const descriptors = mimirBetaCaptureScanDescriptors(cluster);
  const families = new Set<MimirBetaSourceFamily>();
  const sources = sourceInputs.map((untrusted): AdmittedDiscoverySource => {
    const sourceValues = dataRecord(untrusted, ["layouts", "loadProgram", "scan"], "discovery source");
    const layoutsInput = typeof sourceValues.layouts === "string" ? decodeLayouts(sourceValues.layouts) : strictSnapshot(sourceValues.layouts, "discovery source layouts", {
      maxDepth: 3, maxObjects: 13, maxProperties: 75, maxArrayLength: 3, maxArrayItems: 6,
      maxByteLength: 8, maxTotalBytes: 24,
    }) as readonly PoolCoreLayout[];
    const loadProgram = sourceValues.loadProgram as MimirBetaPoolDiscoverySource["loadProgram"];
    const scan = sourceValues.scan as MimirBetaPoolDiscoverySource["scan"];
    if (typeof loadProgram !== "function" || typeof scan !== "function") {
      betaError("INVALID_ARGUMENT", "discovery source invalid");
    }
    const family = layoutsInput[0]?.family;
    if (!family || families.has(family) || layoutsInput.some((layout) => layout.family !== family)) {
      betaError("INVALID_ARGUMENT", "discovery sources must each own one unique family");
    }
    const expected = descriptors.filter((descriptor) => descriptor.family === family)
      .map(mimirBetaCapturePoolCoreLayout).sort((left, right) => left.accountSize - right.accountSize);
    const actual = [...layoutsInput].sort((left, right) => left.accountSize - right.accountSize);
    const normalized = (layout: PoolCoreLayout) => Object.fromEntries(Object.entries(layout).filter(([, value]) => value !== undefined));
    if (actual.length !== expected.length || actual.some((layout, index) =>
      canonicalJson(normalized(layout) as never) !== canonicalJson(normalized(expected[index]!) as never))) {
      betaError("INVALID_ARGUMENT", "discovery source must use the complete exact exported family descriptor set");
    }
    families.add(family);
    return Object.freeze({ layouts: canonicalLayoutsForFamily(family, cluster), loadProgram, scan });
  });
  Object.freeze(sources);
  const receiver = Object.freeze({ cluster, evidenceTtlSlots, maxScanResultsPerFamily,
    maxConfidenceBps: hasMaxConfidenceBps ? maxConfidenceBps as number : undefined, sources, getContext, loadCapturePlanAccounts });
  const byIdentity = new Map(sources.map((source) => {
    const layout = source.layouts[0]!; return [`${layout.family}:${layout.programId}`, source] as const;
  }));

  async function scanSource(source: AdmittedDiscoverySource, args: { baseMint: Address; quoteMint: Address }) {
    const maxScanAccountBytes = Math.max(...source.layouts.map((layout) => layout.accountSize));
    const scanMaxChars = 256 + maxScanResultsPerFamily * (192 + 4 * Math.ceil(maxScanAccountBytes / 3));
    const scanMaxObjects = 1 + maxScanResultsPerFamily * 2;
    const scanMaxProperties = maxScanResultsPerFamily * 3;
    const scanMaxTotalBytes = maxScanResultsPerFamily * maxScanAccountBytes;
    const scanJsonMaxObjects = 2 + maxScanResultsPerFamily * 2;
    const scanJsonMaxProperties = 2 + maxScanResultsPerFamily * 4;
    if (![scanMaxChars, scanMaxObjects, scanMaxProperties, scanMaxTotalBytes, scanJsonMaxObjects,
      scanJsonMaxProperties].every(Number.isSafeInteger)) betaError("INVALID_ARGUMENT", "source scan bounds invalid");
    const programResponse = await source.loadProgram.call(source);
    const program = (typeof programResponse === "string" ? parseSerialized(programResponse, "source program response", 128, {
      maxDepth: 1, maxObjects: 1, maxProperties: 1, maxArrayLength: 0, maxArrayItems: 0, maxByteLength: 0, maxTotalBytes: 0,
      maxTotalStringChars: 96,
    }) : strictSnapshot(programResponse, "source program response", {
      maxDepth: 1, maxObjects: 1, maxProperties: 1, maxArrayLength: 0, maxArrayItems: 0, maxByteLength: 0, maxTotalBytes: 0,
    })) as Readonly<{ executable: boolean }>;
    exactKeys(program, ["executable"], "source program response");
    if (typeof program.executable !== "boolean") betaError("ACCOUNT_MALFORMED", "source program response invalid");
    if (!program.executable) betaError("ACCOUNT_OWNER_MISMATCH", "source program is not executable", source.layouts[0]!.programId);
    const scanResponse = await source.scan.call(source, args);
    const returnedAccounts = (typeof scanResponse === "string"
      ? decodeAccounts(scanResponse, "source scan response", scanMaxChars, maxScanResultsPerFamily, maxScanAccountBytes, false)
      : strictSnapshot(scanResponse, "source scan response", {
      maxDepth: 2, maxObjects: scanMaxObjects, maxProperties: scanMaxProperties,
      maxArrayLength: maxScanResultsPerFamily, maxArrayItems: maxScanResultsPerFamily,
      maxByteLength: maxScanAccountBytes, maxTotalBytes: scanMaxTotalBytes,
    })) as readonly PoolCoreAccount[];
    if (!Array.isArray(returnedAccounts)) betaError("ACCOUNT_MALFORMED", "source scan response invalid");
    if (returnedAccounts.length > maxScanResultsPerFamily) betaError("INVALID_ARGUMENT", "unbounded family scan result");
    const addresses = new Set<string>();
    const accounts = returnedAccounts.map((account): PoolCoreAccount => {
      if (!account || typeof account !== "object") betaError("ACCOUNT_MALFORMED", "scanned pool row invalid");
      exactKeys(account, ["address", "data", "owner"], "scanned pool row", "ACCOUNT_MALFORMED");
      const address = canonicalAddress(account.address, "scanned pool", "ACCOUNT_MALFORMED");
      const owner = canonicalAddress(account.owner, "scanned pool owner", "ACCOUNT_MALFORMED");
      if (!(account.data instanceof Uint8Array)) betaError("ACCOUNT_MALFORMED", "scanned pool data must be bytes", address);
      if (addresses.has(address)) betaError("DUPLICATE_POOL", "ambiguous duplicate scanned pool", address);
      addresses.add(address);
      return Object.freeze({ address, owner, data: account.data });
    });
    return accounts.map((account) => ({ source, account }));
  }

  type PlannedEntry = Readonly<{
    source: AdmittedDiscoverySource;
    descriptor: MimirBetaCaptureScanDescriptor;
    plan: MimirBetaCaptureReadPlan;
    boostVault?: Address;
    bindingVariant?: "direct" | "routeable";
  }>;

  type LoaderPlan = Readonly<{
    planHash: string;
    descriptorId: string;
    descriptorHash: string;
    addresses: readonly Address[];
    nodes: readonly MimirBetaCaptureReadNode[];
  }>;

  function descriptorForScannedAccount(source: AdmittedDiscoverySource, account: PoolCoreAccount): MimirBetaCaptureScanDescriptor {
    const matches = descriptors.filter((descriptor) => descriptor.programId === account.owner &&
      descriptor.allocationSize === account.data.length && source.layouts.some((layout) =>
        layout.programId === descriptor.programId && layout.accountSize === descriptor.allocationSize));
    if (matches.length === 0) betaError("UNKNOWN_CAPTURE_ALLOCATION", "scanned primary has no exact capture descriptor", account.address);
    if (matches.length !== 1) betaError("AMBIGUOUS_CAPTURE_ALLOCATION", "scanned primary matches multiple capture descriptors", account.address);
    return matches[0]!;
  }

  function planScannedEntries(
    entries: readonly Readonly<{ source: AdmittedDiscoverySource; account: PoolCoreAccount }>[],
    pair: Readonly<{ baseMint: Address; quoteMint: Address }>,
    minimum: Readonly<{ slot: bigint; unixTimestamp: bigint }>,
  ): Readonly<{ planned: readonly PlannedEntry[]; ineligible: readonly MimirBetaIneligiblePool[] }> {
    const planned: PlannedEntry[] = [];
    const ineligible: MimirBetaIneligiblePool[] = [];
    for (const { source, account } of entries) {
      const descriptor = descriptorForScannedAccount(source, account);
      try {
        const plan = deriveMimirBetaCaptureReadPlan({ descriptor,
          primary: { address: account.address as Address, owner: account.owner as Address, executable: false, data: account.data },
          pair, context: { observedSlot: minimum.slot, observedUnixTimestamp: minimum.unixTimestamp }, existingFeed });
        planned.push(Object.freeze({ source, descriptor, plan, ...boostVaultOf(descriptor, account) }));
      } catch (error) {
        const exclusionCode = searchRefusalCode(error);
        ineligible.push(Object.freeze({ eligibility: "ineligible" as const, family: descriptor.family, programId: descriptor.programId,
          pool: account.address as Address, baseMint: pair.baseMint, quoteMint: pair.quoteMint, exclusionCode,
          ...(error instanceof MimirBetaPoolIneligibleError ? { exclusionReason: error.reason } : {}) }));
      }
    }
    return { planned, ineligible };
  }

  function searchRefusalCode(error: unknown): "TOKEN_PROGRAM_PAIR_UNSUPPORTED" | "TOKEN_2022_POLICY_UNSUPPORTED" | "POOL_INELIGIBLE" {
    if (error instanceof MimirBetaError && (error.code === "TOKEN_PROGRAM_PAIR_UNSUPPORTED" ||
      error.code === "TOKEN_2022_POLICY_UNSUPPORTED" || error.code === "POOL_INELIGIBLE")) return error.code;
    throw error;
  }

  function boostVaultOf(descriptor: MimirBetaCaptureScanDescriptor, primary: Readonly<{ address: string; data: Uint8Array }>): Readonly<{ boostVault?: Address }> {
    if (descriptor.family !== "pumpswap") return {};
    return { boostVault: deriveMimirBetaPumpSwapBoostVault(primary.address as Address, bytesAddress(primary.data.subarray(75, 107)), MIMIR_BETA_SPL_TOKEN_PROGRAM_ID) };
  }

  async function loadPlanAccounts(planInputs: readonly LoaderPlan[], minimumContextSlot: bigint,
    optional: ReadonlySet<Address> = new Set()): Promise<Readonly<{
    contextSlot: bigint; unixTimestamp: bigint; accounts: ReadonlyMap<Address, MimirBetaCapturedAccount>;
  }>> {
    const requestPlans = planInputs.map((plan) => Object.freeze({ ...plan, addresses: Object.freeze([...plan.addresses, CLOCK_SYSVAR]) }));
    const requested = new Set<Address>(requestPlans.flatMap((plan) => [...plan.addresses]));
    const loadedResponse = await receiver.loadCapturePlanAccounts.call(receiver, Object.freeze({
      minContextSlot: minimumContextSlot, plans: Object.freeze(requestPlans),
    }));
    let loaded: Readonly<{ contextSlot: bigint; accounts: readonly MimirBetaCapturedAccount[] }>;
    if (typeof loadedResponse === "string") {
      const captureMaxChars = 256 + requested.size * (224 + 4 * Math.ceil(MAX_CAPTURE_ACCOUNT_BYTES / 3));
      if (!Number.isSafeInteger(captureMaxChars)) betaError("INVALID_ARGUMENT", "capture loader bounds invalid");
      loaded = decodeAccounts(loadedResponse, "capture loader response", captureMaxChars, requested.size, MAX_CAPTURE_ACCOUNT_BYTES, true);
    } else {
      const responseAccounts = loadedResponse && typeof loadedResponse === "object" ?
        Object.getOwnPropertyDescriptor(loadedResponse, "accounts") : undefined;
      const responseAccountLength = responseAccounts && "value" in responseAccounts && Array.isArray(responseAccounts.value) ?
        Object.getOwnPropertyDescriptor(responseAccounts.value, "length")?.value : undefined;
      if (typeof responseAccountLength === "number" && Number.isSafeInteger(responseAccountLength) && responseAccountLength > requested.size) {
        betaError("CAPTURE_PLAN_MISMATCH", "capture loader returned an incomplete or extra address set");
      }
      loaded = strictSnapshot(loadedResponse, "capture loader response", {
      maxDepth: 3, maxObjects: 2 + requested.size * 2, maxProperties: 2 + requested.size * 4,
      maxArrayLength: requested.size, maxArrayItems: requested.size,
      maxByteLength: MAX_CAPTURE_ACCOUNT_BYTES, maxTotalBytes: requested.size * MAX_CAPTURE_ACCOUNT_BYTES,
      }) as Readonly<{ contextSlot: bigint; accounts: readonly MimirBetaCapturedAccount[] }>;
    }
    if (!loaded || canonicalJson(Object.keys(loaded).sort() as never) !== canonicalJson(["accounts", "contextSlot"] as never) ||
        typeof loaded.contextSlot !== "bigint" || loaded.contextSlot < minimumContextSlot || !Array.isArray(loaded.accounts)) {
      betaError("RPC_CONTEXT_MISMATCH", "capture plan account response/context is invalid");
    }
    const accounts = new Map<Address, MimirBetaCapturedAccount>();
    for (const original of loaded.accounts as readonly unknown[]) {
      if (!original || typeof original !== "object" || canonicalJson(Object.keys(original).sort() as never) !==
          canonicalJson(["address", "data", "executable", "owner"] as never)) betaError("ACCOUNT_MALFORMED", "capture loader row shape is invalid");
      const row = original as MimirBetaCapturedAccount;
      if (!(row.data instanceof Uint8Array) || typeof row.executable !== "boolean" || accounts.has(row.address) || !requested.has(row.address)) {
        betaError("CAPTURE_PLAN_MISMATCH", "capture loader returned null, duplicate, unknown, or malformed row", row.address);
      }
      accounts.set(row.address, Object.freeze({ address: bytesAddress(addressBytes(row.address)), owner: bytesAddress(addressBytes(row.owner)),
        executable: row.executable, data: row.data }));
    }
    if ([...requested].some((value) => !accounts.has(value) && !optional.has(value))) {
      betaError("CAPTURE_PLAN_MISMATCH", "capture loader returned an incomplete or extra address set");
    }
    const clock = accounts.get(CLOCK_SYSVAR)!;
    const clockView = new DataView(clock.data.buffer, clock.data.byteOffset, clock.data.byteLength);
    if (clock.owner !== SYSVAR_OWNER || clock.executable || clock.data.length !== 40 ||
        clockView.getBigUint64(0, true) !== loaded.contextSlot || clockView.getBigInt64(32, true) < 0n) {
      betaError("RPC_CONTEXT_MISMATCH", "capture cohort Clock is not authentic for the context slot", CLOCK_SYSVAR);
    }
    accounts.delete(CLOCK_SYSVAR);
    return { contextSlot: loaded.contextSlot, unixTimestamp: clockView.getBigInt64(32, true), accounts };
  }

  function rebindPlan(entry: PlannedEntry, loaded: Readonly<{ contextSlot: bigint; unixTimestamp: bigint;
    accounts: ReadonlyMap<Address, MimirBetaCapturedAccount> }>): MimirBetaCaptureReadPlan {
    const frozen = entry.plan;
    const plan = deriveMimirBetaCaptureReadPlan({ descriptor: entry.descriptor, primary: loaded.accounts.get(frozen.pool)!,
      pair: { baseMint: frozen.baseMint, quoteMint: frozen.quoteMint },
      context: { observedSlot: loaded.contextSlot, observedUnixTimestamp: loaded.unixTimestamp }, existingFeed });
    if (canonicalJson(plan.allAddresses as never) !== canonicalJson(frozen.allAddresses as never)) {
      if (loaded.contextSlot <= frozen.context.observedSlot) betaError("CAPTURE_PLAN_MISMATCH", "capture closure changed within one context", frozen.pool);
      throw new MimirBetaStalePreparationError({ reason: "source-drift", address: frozen.pool,
        observedSlot: frozen.context.observedSlot, currentSlot: loaded.contextSlot,
        observedUnixTimestamp: frozen.context.observedUnixTimestamp, currentUnixTimestamp: loaded.unixTimestamp });
    }
    return plan;
  }

  async function resolveCapacities(
    entries: readonly PlannedEntry[],
    minimumContextSlot: bigint,
    maxConfidenceBps?: number,
    searchConfidenceAsIneligible = false,
  ): Promise<Readonly<{ contextSlot: bigint; candidates: readonly Readonly<{
    candidate: MimirBetaCaptureCandidate; creation: MimirBetaPoolCreationBinding; plan: MimirBetaCaptureReadPlan;
  } | {
    ineligible: MimirBetaIneligiblePool; plan: MimirBetaCaptureReadPlan;
  }>[] }>> {
    const boostVaults = new Set(entries.flatMap((entry) => entry.boostVault ? [entry.boostVault] : []));
    const requestPlans = entries.map(({ plan, boostVault }) => Object.freeze({
      planHash: plan.planHash, descriptorId: plan.descriptorId, descriptorHash: plan.descriptorHash,
      addresses: Object.freeze([...plan.allAddresses, ...(boostVault ? [boostVault] : [])]), nodes: Object.freeze(plan.auxiliary.map((node) => Object.freeze({
        ...node, derivedFrom: Object.freeze([...node.derivedFrom]),
      }))),
    }));
    const loaded = await loadPlanAccounts(requestPlans, minimumContextSlot, boostVaults);
    const candidates = await Promise.all(entries.map(async (entry) => {
      const { descriptor } = entry;
      let plan = entry.plan;
      try {
        plan = rebindPlan(entry, loaded);
        const planAccounts = plan.allAddresses.map((address) => loaded.accounts.get(address)!);
        const candidate = await decodeMimirBetaCaptureCandidate({ descriptor, pair: { baseMint: plan.baseMint, quoteMint: plan.quoteMint },
          context: plan.context, expectedPlan: plan, accounts: planAccounts, existingFeed,
          ...(entry.boostVault ? { pumpSwapBoostVault: loaded.accounts.get(entry.boostVault) ?? null } : {}) });
        if (maxConfidenceBps !== undefined && descriptor.planRule.kind === "meteora-dlmm") {
          const primary = planAccounts.find((row) => row.address === plan.pool)!;
          const binStep = new DataView(primary.data.buffer, primary.data.byteOffset, primary.data.byteLength)
            .getUint16(descriptor.planRule.binStepOffset, true);
          if (binStep > maxConfidenceBps) {
            if (searchConfidenceAsIneligible) return Object.freeze({ ineligible: Object.freeze({
              eligibility: "ineligible" as const,
              family: descriptor.family,
              programId: descriptor.programId,
              pool: plan.pool,
              baseMint: plan.baseMint,
              quoteMint: plan.quoteMint,
              exclusionCode: "CONFIDENCE_EXCEEDS_POLICY" as const,
            }), plan });
            betaError("POOL_INELIGIBLE", `actual DLMM confidence ${binStep} bps (bin step) exceeds requested maxConfidenceBps ${maxConfidenceBps} bps`, candidate.pool);
          }
        }
        const creation = buildMimirBetaPoolCreationBinding(candidate, entry.bindingVariant);
        return Object.freeze({ candidate, creation, plan });
      } catch (error) {
        if (error instanceof MimirBetaStalePreparationError) throw error;
        if (!searchConfidenceAsIneligible && !(error instanceof MimirBetaError &&
          (error.code === "TOKEN_PROGRAM_PAIR_UNSUPPORTED" || error.code === "TOKEN_2022_POLICY_UNSUPPORTED"))) throw error;
        const exclusionCode = searchRefusalCode(error);
        return Object.freeze({ ineligible: Object.freeze({
          eligibility: "ineligible" as const,
          family: descriptor.family,
          programId: descriptor.programId,
          pool: plan.pool,
          baseMint: plan.baseMint,
          quoteMint: plan.quoteMint,
          exclusionCode,
          ...(error instanceof MimirBetaPoolIneligibleError ? { exclusionReason: error.reason } : {}),
        }), plan });
      }
    }));
    return { contextSlot: loaded.contextSlot, candidates };
  }

  return {
    async listPoolSources() {
      return Promise.all([...sources].sort((left, right) => left.layouts[0]!.family < right.layouts[0]!.family ? -1 : left.layouts[0]!.family > right.layouts[0]!.family ? 1 : 0).map(async ({ layouts }) => {
        const layout = layouts[0]!;
        const spec = FAMILY[layout.family];
        return {
          family: layout.family,
          adapterType: spec.adapterType,
          priority: spec.priority,
          programId: layout.programId as Address,
          layoutHash: await layoutHash(layout.family, cluster),
          supportedBindingVariants: spec.variants,
        };
      }));
    },
    async searchSpotPools(args) {
      const snapshot = snapshotSearchArgs(args);
      const minimum = snapshotContext(await receiver.getContext.call(receiver));
      const entries = (await Promise.all(sources.map((source) => scanSource(source, snapshot)))).flat();
      if (entries.length === 0) betaError("NO_ELIGIBLE_POOLS", "search found no candidate pools");
      const { planned, ineligible: planIneligible } = planScannedEntries(entries, snapshot, minimum);
      const resolved = planned.length === 0 ? { contextSlot: minimum.slot, candidates: [] } :
        await resolveCapacities(planned, minimum.slot, receiver.maxConfidenceBps, true);
      const candidates = resolved.candidates.filter((entry): entry is Extract<typeof entry, { candidate: MimirBetaCaptureCandidate }> => "candidate" in entry).map((candidate) => ({ ...candidate }));
      assertUnambiguousMimirBetaCaptureCandidates(candidates.map(({ candidate }) => candidate));
      candidates.sort((left, right) => compareMimirBetaCaptureCandidates(left.candidate, right.candidate));
      const query = snapshot.query.toLowerCase();
      const eligiblePools = (await Promise.all(candidates.map(async ({ candidate, creation, plan }): Promise<MimirBetaEligiblePool> => {
        const validThroughSlot = resolved.contextSlot + evidenceTtlSlots;
        const pool: MimirBetaEligiblePool = {
          family: candidate.family, programId: candidate.programId, pool: candidate.pool,
          descriptorId: candidate.descriptorId, descriptorHash: candidate.descriptorHash, readPlan: plan,
          canonicalMint0: candidate.canonicalMint0, canonicalMint1: candidate.canonicalMint1,
          canonicalPairKey: candidate.canonicalPairKey, direction: candidate.direction,
          baseMint: candidate.baseMint, quoteMint: candidate.quoteMint, eligibility: "eligible",
          baseVault: candidate.baseVault, quoteVault: candidate.quoteVault,
          adapterVersion: candidate.adapterVersion, token2022Mint: candidate.token2022Mint,
          token2022PolicyHash: candidate.token2022PolicyHash,
          minLiquidityNative: candidate.minLiquidityNative, minDepthTo50BpsNative: candidate.minDepthTo50BpsNative,
          observedSlot: resolved.contextSlot, validThroughSlot, creation,
          evidenceHash: await evidenceHash({ cluster, candidate, creation, observedSlot: resolved.contextSlot, validThroughSlot }),
          ...(candidate.pointOnly ? { pointOnly: true as const } : {}),
          ...(candidate.boostVaultLamports !== undefined
            ? { boostVaultLamports: candidate.boostVaultLamports, maxBoostDriftBps: candidate.maxBoostDriftBps!, pumpSwapBaseIsA: candidate.pumpSwapBaseIsA! } : {}),
        };
        if (candidate.conditions) eligiblePoolConditions.set(pool, candidate.conditions);
        return pool;
      }))).filter((pool) => query.length === 0 || `${pool.family} ${pool.programId} ${pool.pool}`.toLowerCase().includes(query));
      const ineligiblePools = [...planIneligible, ...resolved.candidates.filter((entry): entry is Extract<typeof entry, { ineligible: MimirBetaIneligiblePool }> => "ineligible" in entry)
        .map(({ ineligible }) => ineligible)]
        .filter((pool) => query.length === 0 || `${pool.family} ${pool.programId} ${pool.pool}`.toLowerCase().includes(query));
      const pools: readonly MimirBetaPool[] = [...eligiblePools, ...ineligiblePools];
      const recommendedPools = eligiblePools.slice(0, snapshot.maxPools);
      const result = { baseMint: snapshot.baseMint, quoteMint: snapshot.quoteMint, query: snapshot.query, observedSlot: resolved.contextSlot,
        pools, recommendedPools, maxPools: snapshot.maxPools };
      return { ...result, searchHash: await domainHash("MIMIR_BETA_POOL_SEARCH_V1\0", canonicalJson(result as never)) };
    },
    async revalidateSelectedPools(args) {
      const snapshot = snapshotRevalidationArgs(args);
      const minimum = snapshotContext(await receiver.getContext.call(receiver));
      if (minimum.slot < snapshot.minContextSlot) betaError("RPC_CONTEXT_MISMATCH", "pool revalidation context regressed");
      const entries: PlannedEntry[] = [];
      for (const prior of snapshot.pools) {
        const source = byIdentity.get(`${prior.family}:${prior.programId}`);
        if (!source) betaError("POOL_STALE", "selected pool source no longer configured", prior.pool);
        if (prior.readPlan.pool !== prior.pool || prior.readPlan.planHash.length !== 64 || prior.readPlan.descriptorId !== prior.descriptorId ||
            prior.readPlan.descriptorHash !== prior.descriptorHash || prior.readPlan.baseMint !== prior.baseMint || prior.readPlan.quoteMint !== prior.quoteMint) {
          betaError("POOL_STALE", "selected pool frozen plan binding is invalid", prior.pool);
        }
        const matches = descriptors.filter((descriptor) => descriptor.descriptorId === prior.descriptorId && descriptor.descriptorHash === prior.descriptorHash);
        if (matches.length !== 1) betaError("UNKNOWN_CAPTURE_DESCRIPTOR", "selected pool descriptor is no longer exact", prior.pool);
        entries.push(Object.freeze({ source, descriptor: matches[0]!, plan: prior.readPlan }));
      }
      const pair = { baseMint: snapshot.pools[0]!.baseMint, quoteMint: snapshot.pools[0]!.quoteMint };
      if (snapshot.pools.some((pool) => pool.baseMint !== pair.baseMint || pool.quoteMint !== pair.quoteMint)) betaError("INVALID_ARGUMENT", "selected pools must share one oriented pair");
      const requestedMinimum = minimum.slot > snapshot.minContextSlot ? minimum.slot : snapshot.minContextSlot;
      const reused = entries.some(({ descriptor }) => descriptor.family === "pumpswap") ? null : await resolveCapacities(entries.map((entry, index) =>
        Object.freeze({ ...entry, bindingVariant: snapshot.pools[index]!.creation.bindingVariant })), requestedMinimum, snapshot.maxConfidenceBps)
        .catch((error: unknown) => {
          if (error instanceof MimirBetaStalePreparationError || error instanceof MimirBetaError && error.code === "CAPTURE_PLAN_MISMATCH") return null;
          throw error;
        });
      const resolved = reused ?? await (async () => {
        const primaries = await loadPlanAccounts(entries.map(({ plan }) => Object.freeze({
          planHash: plan.planHash, descriptorId: plan.descriptorId, descriptorHash: plan.descriptorHash,
          addresses: Object.freeze([plan.pool]), nodes: Object.freeze([]),
        })), requestedMinimum);
        const currentEntries = entries.map(({ source, descriptor }, index) => Object.freeze({ source, descriptor,
          bindingVariant: snapshot.pools[index]!.creation.bindingVariant,
          ...boostVaultOf(descriptor, primaries.accounts.get(snapshot.pools[index]!.pool)!),
          plan: deriveMimirBetaCaptureReadPlan({ descriptor, primary: primaries.accounts.get(snapshot.pools[index]!.pool)!, pair,
            context: { observedSlot: primaries.contextSlot, observedUnixTimestamp: primaries.unixTimestamp }, existingFeed }),
        }));
        return resolveCapacities(currentEntries, primaries.contextSlot, snapshot.maxConfidenceBps);
      })();
      const freshPools: MimirBetaEligiblePool[] = [];
      for (let index = 0; index < snapshot.pools.length; index += 1) {
        const prior = snapshot.pools[index]!; const resolvedEntry = resolved.candidates[index]!;
        if (!("candidate" in resolvedEntry)) betaError("POOL_STALE", "selected pool became Token-2022-policy-ineligible", prior.pool);
        const { candidate, creation, plan } = resolvedEntry;
        const validThroughSlot = resolved.contextSlot + evidenceTtlSlots;
        const fresh: MimirBetaEligiblePool = {
          family: candidate.family, programId: candidate.programId, pool: candidate.pool,
          descriptorId: candidate.descriptorId, descriptorHash: candidate.descriptorHash, readPlan: plan,
          canonicalMint0: candidate.canonicalMint0, canonicalMint1: candidate.canonicalMint1,
          canonicalPairKey: candidate.canonicalPairKey, direction: candidate.direction,
          baseMint: candidate.baseMint, quoteMint: candidate.quoteMint, eligibility: "eligible",
          baseVault: candidate.baseVault, quoteVault: candidate.quoteVault,
          adapterVersion: candidate.adapterVersion, token2022Mint: candidate.token2022Mint,
          token2022PolicyHash: candidate.token2022PolicyHash,
          minLiquidityNative: candidate.minLiquidityNative, minDepthTo50BpsNative: candidate.minDepthTo50BpsNative,
          observedSlot: resolved.contextSlot, validThroughSlot, creation,
          evidenceHash: await evidenceHash({ cluster, candidate, creation, observedSlot: resolved.contextSlot, validThroughSlot }),
          ...(candidate.pointOnly ? { pointOnly: true as const } : {}),
          ...(candidate.boostVaultLamports !== undefined
            ? { boostVaultLamports: candidate.boostVaultLamports, maxBoostDriftBps: candidate.maxBoostDriftBps!, pumpSwapBaseIsA: candidate.pumpSwapBaseIsA! } : {}),
        };
        const stable = (pool: MimirBetaEligiblePool) => ({
          eligibility: pool.eligibility, family: pool.family, programId: pool.programId, pool: pool.pool,
          descriptorId: pool.descriptorId, descriptorHash: pool.descriptorHash,
          canonicalMint0: pool.canonicalMint0, canonicalMint1: pool.canonicalMint1, canonicalPairKey: pool.canonicalPairKey,
          direction: pool.direction, baseMint: pool.baseMint, quoteMint: pool.quoteMint,
          baseVault: pool.baseVault, quoteVault: pool.quoteVault, adapterVersion: pool.adapterVersion,
          token2022Mint: pool.token2022Mint, token2022PolicyHash: pool.token2022PolicyHash, creation: pool.creation,
          pointOnly: pool.pointOnly === true,
          readPlan: {
            schema: pool.readPlan.schema, family: pool.readPlan.family, program: pool.readPlan.program, pool: pool.readPlan.pool,
            descriptorId: pool.readPlan.descriptorId, descriptorHash: pool.readPlan.descriptorHash,
            canonicalMint0: pool.readPlan.canonicalMint0, canonicalMint1: pool.readPlan.canonicalMint1,
            canonicalPairKey: pool.readPlan.canonicalPairKey, direction: pool.readPlan.direction,
            baseMint: pool.readPlan.baseMint, quoteMint: pool.readPlan.quoteMint,
            baseVault: pool.readPlan.baseVault, quoteVault: pool.readPlan.quoteVault,
            auxiliary: pool.readPlan.auxiliary.filter((node) => !node.role.startsWith("tick-array-") && node.role !== "depth-bin-array"),
          },
        });
        if (canonicalJson(stable(prior) as never) !== canonicalJson(stable(fresh) as never)) {
          betaError("POOL_STALE", "selected pool stable projection changed", prior.pool);
        }
        if (candidate.conditions) eligiblePoolConditions.set(fresh, candidate.conditions);
        freshPools.push(Object.freeze(fresh));
      }
      return { slot: resolved.contextSlot, pools: snapshot.pools, freshPools: Object.freeze(freshPools) };
    },
  };
}

export function validateSelectedPools(pools: readonly MimirBetaPool[], currentSlot: bigint): asserts pools is readonly MimirBetaEligiblePool[] {
  if (pools.length === 0) betaError("NO_ELIGIBLE_POOLS", "selected pool set is empty");
  if (pools.length > 5) betaError("POOL_COUNT_OUT_OF_RANGE", "selected pools must total 1..5");
  const addresses = new Set<string>(); const vaults = new Set<string>(); const evidence = new Set<string>();
  for (const pool of pools) {
    if (pool.eligibility !== "eligible") betaError("POOL_INELIGIBLE", "selected pool is ineligible", pool.pool);
    if (currentSlot > pool.validThroughSlot) betaError("POOL_STALE", "selected pool evidence expired", pool.pool);
    if (addresses.has(pool.pool) || vaults.has(pool.baseVault) || vaults.has(pool.quoteVault) || pool.baseVault === pool.quoteVault ||
        evidence.has(pool.evidenceHash)) betaError("DUPLICATE_POOL", "duplicate selected pool or vault", pool.pool);
    addresses.add(pool.pool); vaults.add(pool.baseVault); vaults.add(pool.quoteVault); evidence.add(pool.evidenceHash);
  }
}

export interface MimirBetaCurrentPointProfileAssessment {
  readonly admitted: boolean;
  readonly sourceFloorsNative: readonly bigint[];
  readonly floorBudgetNative: bigint | null;
  readonly caps: MimirCurrentPointCaps | null;
  readonly readiness: "ready-after-first-publication" | "not-admitted";
  readonly recommended: boolean;
  readonly dust: boolean;
  readonly disclosure: string | null;
}

/** Point profile estimate: F = max(1, floor(D50 * depthFloorBps / 10_000)) per AMMv4/PumpSwap source, F* = min over the cohort; never from off-chain liquidity. */
export function assessMimirBetaCurrentPointProfile(pools: readonly MimirBetaEligiblePool[], quote: Readonly<{
  quoteDecimals: number; quoteToUsdcLowerX64?: bigint;
  /** Creation-policy depth fraction in basis points (1..10_000); defaults to 900 (9%). */
  depthFloorBps?: number }>): MimirBetaCurrentPointProfileAssessment {
  const admitted = pools.length > 0 && pools.length <= 5 &&
    pools.every((pool) => pool.creation.adapterType !== 3 && mimirCurrentPointAdmitted(pool.creation.adapterType, pool.creation.adapterVersion));
  if (!admitted) return { admitted, sourceFloorsNative: [], floorBudgetNative: null, caps: null, readiness: "not-admitted",
    recommended: false, dust: false, disclosure: "current-point profile requires AMMv4 or PumpSwap sources" };
  const sourceFloorsNative = pools.map((pool) => conservativeMintOracleSourceConfigFloor(pool.minDepthTo50BpsNative, quote.depthFloorBps ?? 900));
  const floorBudgetNative = mimirCurrentPointFloorBudget(sourceFloorsNative);
  const caps = mimirCurrentPointCaps({ floorNative: floorBudgetNative, ...quote });
  const recommended = caps.positionUsdc6 >= MIMIR_CURRENT_POINT_RECOMMENDED_POSITION_USDC6;
  const dust = caps.positionUsdc6 === 0n;
  return { admitted, sourceFloorsNative, floorBudgetNative, caps, readiness: "ready-after-first-publication", recommended, dust,
    disclosure: recommended ? null : dust
      ? `dust feed: position cap 0 USDC6 (F* ${caps.floorUsdc6} USDC6); price can publish but no position can open`
      : `position cap ${caps.positionUsdc6} USDC6 below recommended ${MIMIR_CURRENT_POINT_RECOMMENDED_POSITION_USDC6} USDC6 (shared cap ${caps.sharedUsdc6})` };
}
