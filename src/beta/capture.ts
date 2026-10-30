import {
  address,
  type Address,
} from "@solana/kit";
import { getProgramDerivedAddressCached } from "./pdaMemo.js";
import { sha256 as sha256Sync } from "@noble/hashes/sha256";
import {
  Q64,
  cpmmZeroFeeImmediateUnwindBounds,
  meteoraDlmmPriceFromIdX64,
  normalizedDirectQ64PriceX64,
  normalizedInverseQ64PriceX64,
  squareQ64ToX64,
} from "../math.js";
import type { PoolCoreLayout } from "../internal/rpcPoolDiscoveryCore.js";
import { parseRaydiumClmmNativeTwapObservationState } from "../internal/nativeMonoRefreshCore.js";
import {
  addressBytes,
  bytesAddress,
  bytesEqual,
  canonicalJson,
  concatBytes,
  domainHash,
  hex,
  isZeroBytes,
  sha256,
  utf8,
} from "./bytes.js";
import { betaError, MimirBetaError, MimirBetaPoolIneligibleError } from "./errors.js";
import { MIMIR_BETA_CLUSTER_TABLES } from "./cluster.js";
import type { MimirBetaCluster } from "./deployment.js";
import {
  validateMimirBetaDeployment,
  type MimirBetaDeployment,
} from "./deployment.js";
import {
  createMimir8004IdentityAdapter,
  decodeMimir8004RegistryConfig,
  decodeMimir8004RootConfig,
  verifyMimir8004ConfigPdas,
  type Mimir8004RegistryConfig,
  type Mimir8004RootConfig,
} from "./identity8004.js";
import { decodeMimirBetaCoreCollection } from "./mplCore.js";
import {
  classifyToken2022ClmmPair,
  computeToken2022ClmmPolicyHash,
  isToken2022ClmmAccountError,
  isToken2022ClmmPolicyError,
  classifyToken2022Mint,
  classifyToken2022PumpSwapMetadataMint,
  classifyToken2022Vault,
  type Token2022ClmmPairClassification,
} from "../token2022Clmm.js";
import { MIMIR_COND } from "../liveness.js";
import type { MimirBetaAccount, MimirBetaAdapterVersion, MimirBetaSourceFamily } from "./types.js";
import { canonicalAddress } from "../internal/canonicalAuthority.js";

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;
const U256_MAX = (1n << 256n) - 1n;
const PUMP_NATIVE_MINT_2022 = address("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP");
const SQRT_DOWN_50_BPS_X64 = 18_400_569_422_882_917_161n;
const SQRT_UP_50_BPS_X64 = 18_492_803_431_484_993_638n;
const MAX_CAPTURE_ACCOUNTS_PER_POOL = 10;
const MAX_GLOBAL_CAPTURE_ACCOUNTS = 100;
const PDA_MARKER = utf8("ProgramDerivedAddress");

function compareAscii(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

export const MIMIR_BETA_SPL_TOKEN_PROGRAM_ID = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID = address(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);
const SPL_NATIVE_MINT = address("So11111111111111111111111111111111111111112");
export const MIMIR_BETA_TOKEN_2022_PROGRAM_ID = address("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const SYSTEM_PROGRAM_ID = address("11111111111111111111111111111111");
const ammV4MarketProgramOk = (ammProgram: Address, marketProgram: Address) => Object.values(MIMIR_BETA_CLUSTER_TABLES)
  .some((table) => table.venuePrograms["raydium-amm-v4"] === ammProgram && table.ammV4MarketPrograms.includes(marketProgram));
const PUMP_PROGRAM_ID = address("6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P");
const PUMP_FEE_PROGRAM_ID = address("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
export const MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET = MIMIR_BETA_CLUSTER_TABLES["mainnet-beta"].orcaWhirlpoolsConfig;
const PROGRAMS = MIMIR_BETA_CLUSTER_TABLES["mainnet-beta"].venuePrograms as Readonly<Record<MimirBetaSourceFamily, Address>>;

const POOL_DISCRIMINATOR = Uint8Array.of(247, 237, 227, 245, 215, 195, 222, 70);
const AMM_CONFIG_DISCRIMINATOR = Uint8Array.of(218, 244, 33, 104, 203, 203, 43, 111);
const DAMM_V2_AUTHORITY = bytesAddress(Uint8Array.of(
  242, 204, 213, 53, 172, 165, 241, 115, 106, 200, 34, 221, 7, 115, 228, 217,
  47, 189, 138, 89, 178, 148, 3, 80, 2, 149, 169, 1, 28, 115, 169, 229,
));

export type MimirBetaCaptureReadNodeRole =
  | "base-mint"
  | "quote-mint"
  | "base-vault"
  | "quote-vault"
  | "whirlpools-config"
  | "amm-config"
  | "cpmm-observation"
  | "open-orders"
  | "market"
  | "market-program"
  | "clmm-observation"
  | "global-config"
  | "fee-config"
  | "tick-array-lower"
  | "tick-array-active"
  | "tick-array-upper"
  | "depth-bin-array"
  | "orca-oracle";

export interface MimirBetaCapturedAccount {
  readonly address: Address;
  readonly owner: Address;
  readonly executable: boolean;
  readonly data: Uint8Array;
}

export interface MimirBetaCaptureReadNode {
  readonly address: Address;
  readonly role: MimirBetaCaptureReadNodeRole;
  readonly index: string | null;
  readonly derivedFrom: readonly Address[];
}

type CapturePlanRule =
  | Readonly<{ kind: "orca-whirlpool"; configOffset: 8; tickOffset: 81; tickSpacingOffset: 41; tickArraySize: 88; whirlpoolsConfig?: Address }>
  | Readonly<{ kind: "raydium-clmm"; configOffset: 9; observationOffset: 201; tickOffset: 269; tickSpacingOffset: 235; tickArraySize: 60 }>
  | Readonly<{ kind: "raydium-cpmm"; configOffset: 8; observationOffset: 296 }>
  | Readonly<{ kind: "raydium-amm-v4"; openOrdersOffset: 496; marketOffset: 528; marketProgramOffset: 560 }>
  | Readonly<{ kind: "pumpswap" }>
  | Readonly<{ kind: "meteora-dlmm"; activeIdOffset: 76; binStepOffset: 80; binsPerArray: 70; depthBps: 50 }>
  | Readonly<{ kind: "meteora-damm-v2" }>;

export interface MimirBetaCaptureScanDescriptor {
  readonly descriptorId: string;
  readonly descriptorHash: string;
  readonly family: MimirBetaSourceFamily;
  readonly programId: Address;
  readonly allocationSize: number;
  readonly discriminatorOffset: 0;
  readonly discriminator: Uint8Array | null;
  readonly mintAOffset: number;
  readonly mintBOffset: number;
  readonly vaultAOffset: number;
  readonly vaultBOffset: number;
  readonly status?: Readonly<{
    offset: number;
    enabled?: number;
    disabledMask?: number;
    acceptedU64?: readonly bigint[];
  }>;
  readonly activation?: Readonly<{
    offset: number;
    typeOffset?: number;
    slotType?: number;
    timestampType?: number;
  }>;
  readonly planRule: CapturePlanRule;
  readonly maxAuxiliaryAccounts: number;
  readonly maxResults: 5;
}

export interface MimirBetaCaptureReadPlan {
  readonly schema: "mimir-beta-capture-read-plan-v1";
  readonly descriptorId: string;
  readonly descriptorHash: string;
  readonly family: MimirBetaSourceFamily;
  readonly program: Address;
  readonly pool: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly canonicalMint0: Address;
  readonly canonicalMint1: Address;
  readonly canonicalPairKey: string;
  readonly direction: "quote-per-base";
  readonly baseVault: Address;
  readonly quoteVault: Address;
  readonly primaryDataSha256: string;
  readonly context: Readonly<{ observedSlot: bigint; observedUnixTimestamp: bigint }>;
  readonly auxiliary: readonly MimirBetaCaptureReadNode[];
  readonly allAddresses: readonly Address[];
  readonly planHash: string;
}

export interface MimirBetaCaptureCandidateInput {
  readonly descriptor: MimirBetaCaptureScanDescriptor;
  readonly pair: Readonly<{ baseMint: Address; quoteMint: Address }>;
  readonly context: Readonly<{ observedSlot: bigint; observedUnixTimestamp: bigint }>;
  readonly expectedPlan: MimirBetaCaptureReadPlan;
  readonly accounts: readonly MimirBetaCapturedAccount[];
  readonly pumpSwapBoostVault?: MimirBetaCapturedAccount | null;
  /** Existing-feed rediscovery: no CREATE-only admission witness (the adaptive Orca Oracle) is planned, read or required. */
  readonly existingFeed?: boolean;
}

export interface MimirBetaCaptureEvidenceAccount {
  readonly role: "pool" | MimirBetaCaptureReadNodeRole;
  readonly index: string | null;
  readonly address: Address;
  readonly owner: Address;
  readonly executable?: boolean;
  readonly dataHash: string;
}

export interface MimirBetaCaptureCandidate {
  readonly descriptorId: string;
  readonly descriptorHash: string;
  readonly readPlanHash: string;
  readonly family: MimirBetaSourceFamily;
  readonly programId: Address;
  readonly pool: Address;
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
  readonly tokenProgramId: Address;
  readonly vaultAuthority: Address;
  readonly familyConfig: Address | null;
  readonly observationState: Address | null;
  readonly minLiquidityNative: bigint;
  readonly minDepthTo50BpsNative: bigint;
  readonly capacityEvidence: readonly MimirBetaCaptureEvidenceAccount[];
  readonly capacityHash: string;
  readonly pointOnly?: true;
  readonly boostVaultLamports?: bigint;
  readonly maxBoostDriftBps?: bigint;
  readonly pumpSwapBaseIsA?: boolean;
  /** Mimir condition word and issuer powers observed at capture; conditioned issuers are listed, never filtered. */
  readonly conditions?: number;
  readonly powersMask?: number;
}

export interface MimirBetaCaptureCohortPair {
  readonly mint0: Address;
  readonly mint1: Address;
  readonly pools: readonly MimirBetaCaptureCandidate[];
}

export interface MimirBetaCaptureCohort {
  readonly pairs: readonly MimirBetaCaptureCohortPair[];
  readonly pools: readonly MimirBetaCaptureCandidate[];
}

export type MimirBetaCaptureExecutableProgramRole =
  | "source-program"
  | "agent-registry-program"
  | "mpl-core-program";

export type MimirBetaCaptureRole =
  | "pool"
  | MimirBetaCaptureReadNodeRole
  | MimirBetaCaptureExecutableProgramRole
  | "source-program-data"
  | "agent-registry-program-data"
  | "mpl-core-program-data"
  | "8004-root-config"
  | "8004-registry-config"
  | "physical-core-collection";

export interface MimirBetaCaptureRoleNode {
  readonly address: Address;
  readonly roles: readonly [MimirBetaCaptureRole, ...MimirBetaCaptureRole[]];
  readonly derivedFrom: readonly Address[];
}

export interface MimirBetaCaptureProgramRelation {
  readonly program: Address;
  readonly programData: Address;
  readonly loader: typeof MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID;
  readonly programDataElfOffset: 45;
  readonly programDataElfLength: number;
  readonly programDataElfSha256: string;
  readonly roles: readonly [MimirBetaCaptureExecutableProgramRole];
}

export interface MimirBetaCaptureSelectedPoolPlan {
  readonly descriptor: MimirBetaCaptureScanDescriptor;
  readonly pair: Readonly<{ readonly baseMint: Address; readonly quoteMint: Address }>;
  readonly context: Readonly<{ readonly observedSlot: bigint; readonly observedUnixTimestamp: bigint }>;
  readonly expectedPlan: MimirBetaCaptureReadPlan;
}

export interface MimirBetaCaptureTrustExpectations {
  readonly deployment: MimirBetaDeployment;
  readonly rootConfig: Mimir8004RootConfig;
  readonly registryConfig: Mimir8004RegistryConfig;
}

export interface MimirBetaCapturePreGmaExpectations {
  readonly cohort: MimirBetaCaptureCohort;
  readonly selectedPools: readonly MimirBetaCaptureSelectedPoolPlan[];
  readonly planAddresses: readonly Address[];
  readonly roleGraph: readonly MimirBetaCaptureRoleNode[];
  readonly programs: readonly MimirBetaCaptureProgramRelation[];
}

export interface MimirBetaCaptureRevalidationInput {
  readonly preGma: MimirBetaCapturePreGmaExpectations;
  readonly trust: MimirBetaCaptureTrustExpectations;
  readonly accounts: readonly MimirBetaAccount[];
}

export interface MimirBetaCaptureRevalidationResult {
  readonly schema: "mimir-beta-capture-revalidation-v1";
  readonly cohort: MimirBetaCaptureCohort;
  readonly planAddresses: readonly Address[];
  readonly addresses: readonly Address[];
  readonly roleGraph: readonly MimirBetaCaptureRoleNode[];
  readonly programs: readonly MimirBetaCaptureProgramRelation[];
}

type DescriptorSource = Omit<MimirBetaCaptureScanDescriptor, "descriptorHash">;

function descriptorPayload(descriptor: DescriptorSource): Record<string, unknown> {
  return Object.fromEntries(Object.entries(descriptor).filter(([, value]) => value !== undefined));
}

function syncDomainHash(domain: string, canonical: string): string {
  return hex(sha256Sync(concatBytes(utf8(domain), utf8(canonical))));
}

function frozenStatus(status: NonNullable<MimirBetaCaptureScanDescriptor["status"]>) {
  return Object.freeze({ ...status,
    ...(status.acceptedU64 ? { acceptedU64: Object.freeze([...status.acceptedU64]) } : {}) });
}

function descriptorSources(cluster: MimirBetaCluster): DescriptorSource[] {
  const table = MIMIR_BETA_CLUSTER_TABLES[cluster]; const PROGRAMS = table.venuePrograms as Readonly<Record<MimirBetaSourceFamily, Address>>;
  const orcaConfig = cluster === "devnet" ? { whirlpoolsConfig: table.orcaWhirlpoolsConfig } : {};
  return ([
  {
    descriptorId: "meteora-damm-v2-1112-v1", family: "meteora-damm-v2", programId: PROGRAMS["meteora-damm-v2"], allocationSize: 1_112,
    discriminatorOffset: 0, discriminator: Uint8Array.of(241, 154, 109, 4, 17, 177, 109, 188),
    mintAOffset: 168, mintBOffset: 200, vaultAOffset: 232, vaultBOffset: 264,
    status: { offset: 481, enabled: 0 },
    activation: { offset: 472, typeOffset: 480, slotType: 0, timestampType: 1 },
    planRule: { kind: "meteora-damm-v2" }, maxAuxiliaryAccounts: 4, maxResults: 5,
  },
  {
    descriptorId: "meteora-dlmm-904-v1", family: "meteora-dlmm", programId: PROGRAMS["meteora-dlmm"], allocationSize: 904,
    discriminatorOffset: 0, discriminator: Uint8Array.of(33, 11, 49, 98, 181, 101, 177, 13),
    mintAOffset: 88, mintBOffset: 120, vaultAOffset: 152, vaultBOffset: 184,
    status: { offset: 82, enabled: 0 },
    activation: { offset: 816, typeOffset: 86, slotType: 0, timestampType: 1 },
    planRule: { kind: "meteora-dlmm", activeIdOffset: 76, binStepOffset: 80, binsPerArray: 70, depthBps: 50 }, maxAuxiliaryAccounts: 7, maxResults: 5,
  },
  {
    descriptorId: "orca-whirlpool-653-v1", family: "orca-whirlpool", programId: PROGRAMS["orca-whirlpool"], allocationSize: 653,
    discriminatorOffset: 0, discriminator: Uint8Array.of(63, 149, 209, 12, 225, 128, 99, 9),
    mintAOffset: 101, mintBOffset: 181, vaultAOffset: 133, vaultBOffset: 213,
    planRule: { kind: "orca-whirlpool", configOffset: 8, tickOffset: 81, tickSpacingOffset: 41, tickArraySize: 88, ...orcaConfig }, maxAuxiliaryAccounts: 9, maxResults: 5,
  },
  {
    descriptorId: "raydium-clmm-1544-v1", family: "raydium-clmm", programId: PROGRAMS["raydium-clmm"], allocationSize: 1_544,
    discriminatorOffset: 0, discriminator: POOL_DISCRIMINATOR.slice(),
    mintAOffset: 73, mintBOffset: 105, vaultAOffset: 137, vaultBOffset: 169,
    status: { offset: 389, enabled: 0, disabledMask: 16 },
    activation: { offset: 1_080 },
    planRule: { kind: "raydium-clmm", configOffset: 9, observationOffset: 201, tickOffset: 269, tickSpacingOffset: 235, tickArraySize: 60 }, maxAuxiliaryAccounts: 9, maxResults: 5,
  },
  {
    descriptorId: "pumpswap-300-v1", family: "pumpswap", programId: PROGRAMS.pumpswap, allocationSize: 300,
    discriminatorOffset: 0, discriminator: Uint8Array.of(241, 154, 109, 4, 17, 177, 109, 188),
    mintAOffset: 43, mintBOffset: 75, vaultAOffset: 139, vaultBOffset: 171,
    planRule: { kind: "pumpswap" }, maxAuxiliaryAccounts: 6, maxResults: 5,
  },
  {
    descriptorId: "pumpswap-301-v1", family: "pumpswap", programId: PROGRAMS.pumpswap, allocationSize: 301,
    discriminatorOffset: 0, discriminator: Uint8Array.of(241, 154, 109, 4, 17, 177, 109, 188),
    mintAOffset: 43, mintBOffset: 75, vaultAOffset: 139, vaultBOffset: 171,
    planRule: { kind: "pumpswap" }, maxAuxiliaryAccounts: 6, maxResults: 5,
  },
  {
    descriptorId: "pumpswap-287-v1", family: "pumpswap", programId: PROGRAMS.pumpswap, allocationSize: 287,
    discriminatorOffset: 0, discriminator: Uint8Array.of(241, 154, 109, 4, 17, 177, 109, 188),
    mintAOffset: 43, mintBOffset: 75, vaultAOffset: 139, vaultBOffset: 171,
    planRule: { kind: "pumpswap" }, maxAuxiliaryAccounts: 6, maxResults: 5,
  },
  {
    descriptorId: "raydium-amm-v4-752-v1", family: "raydium-amm-v4", programId: PROGRAMS["raydium-amm-v4"], allocationSize: 752,
    discriminatorOffset: 0, discriminator: null, mintAOffset: 400, mintBOffset: 432, vaultAOffset: 336, vaultBOffset: 368,
    status: { offset: 0, acceptedU64: [1n, 6n] }, activation: { offset: 224 },
    planRule: { kind: "raydium-amm-v4", openOrdersOffset: 496, marketOffset: 528, marketProgramOffset: 560 }, maxAuxiliaryAccounts: 7, maxResults: 5,
  },
  {
    descriptorId: "raydium-cpmm-637-v1", family: "raydium-cpmm", programId: PROGRAMS["raydium-cpmm"], allocationSize: 637,
    discriminatorOffset: 0, discriminator: POOL_DISCRIMINATOR.slice(),
    mintAOffset: 168, mintBOffset: 200, vaultAOffset: 72, vaultBOffset: 104,
    status: { offset: 329, enabled: 0, disabledMask: 4 },
    activation: { offset: 373 }, planRule: { kind: "raydium-cpmm", configOffset: 8, observationOffset: 296 }, maxAuxiliaryAccounts: 6, maxResults: 5,
  },
] satisfies DescriptorSource[]).filter((source) => table.venuePrograms[source.family] !== null);
}

const clusterDescriptors = (cluster: MimirBetaCluster): readonly MimirBetaCaptureScanDescriptor[] => Object.freeze(descriptorSources(cluster).map((source) => Object.freeze({
  ...source,
  descriptorHash: syncDomainHash("MIMIR_BETA_CAPTURE_DESCRIPTOR_V1\0", canonicalJson(descriptorPayload(source) as never)),
  discriminator: source.discriminator?.slice() ?? null,
  ...(source.status ? { status: frozenStatus(source.status) } : {}),
  ...(source.activation ? { activation: Object.freeze({ ...source.activation }) } : {}),
  planRule: Object.freeze({ ...source.planRule }),
})).sort((left, right) => compareAscii(left.descriptorId, right.descriptorId)));
const DESCRIPTORS = clusterDescriptors("mainnet-beta");
const DEVNET_DESCRIPTORS = clusterDescriptors("devnet");
const ALL_DESCRIPTORS = [...DESCRIPTORS, ...DEVNET_DESCRIPTORS.filter((entry) => !DESCRIPTORS.some((main) => main.descriptorHash === entry.descriptorHash))];

/** Every exported descriptor across clusters; descriptor hashes are cluster-exact. */
export function mimirBetaAllCaptureScanDescriptors(): readonly MimirBetaCaptureScanDescriptor[] {
  const mainnet = mimirBetaCaptureScanDescriptors("mainnet-beta"); const hashes = new Set(mainnet.map((entry) => entry.descriptorHash));
  return [...mainnet, ...mimirBetaCaptureScanDescriptors("devnet").filter((entry) => !hashes.has(entry.descriptorHash))];
}

export function mimirBetaCaptureScanDescriptors(cluster: MimirBetaCluster = "mainnet-beta"): readonly MimirBetaCaptureScanDescriptor[] {
  return (cluster === "devnet" ? DEVNET_DESCRIPTORS : DESCRIPTORS).map((descriptor) => Object.freeze({
    ...descriptor,
    discriminator: descriptor.discriminator?.slice() ?? null,
    ...(descriptor.status ? { status: frozenStatus(descriptor.status) } : {}),
    ...(descriptor.activation ? { activation: Object.freeze({ ...descriptor.activation }) } : {}),
    planRule: Object.freeze({ ...descriptor.planRule }),
  }));
}

/** Converts one exported descriptor into the legacy injected scan-layout shape. */
export function mimirBetaCapturePoolCoreLayout(descriptor: MimirBetaCaptureScanDescriptor): PoolCoreLayout {
  return {
    family: descriptor.family,
    programId: descriptor.programId,
    accountSize: descriptor.allocationSize,
    discriminatorOffset: descriptor.discriminatorOffset,
    discriminator: descriptor.discriminator?.slice() ?? null,
    mintAOffset: descriptor.mintAOffset,
    mintBOffset: descriptor.mintBOffset,
    vaultAOffset: descriptor.vaultAOffset,
    vaultBOffset: descriptor.vaultBOffset,
    ...(descriptor.status ? { status: frozenStatus(descriptor.status) } : {}),
    ...(descriptor.activation ? { activation: descriptor.activation } : {}),
  };
}

function fail(message: string, account?: Address): never {
  return betaError("POOL_INELIGIBLE", message, account);
}

function checkedAddress(value: Address, label: string): Address {
  try { return address(value); }
  catch { return betaError("INVALID_ARGUMENT", `${label} is not a canonical address`); }
}

function view(data: Uint8Array, offset: number, length: number): DataView {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset + length > data.length) fail("capacity account offset out of bounds");
  return new DataView(data.buffer, data.byteOffset + offset, length);
}

function u16(data: Uint8Array, offset: number): number { return view(data, offset, 2).getUint16(0, true); }
function u32(data: Uint8Array, offset: number): number { return view(data, offset, 4).getUint32(0, true); }
function i32(data: Uint8Array, offset: number): number { return view(data, offset, 4).getInt32(0, true); }
function u64(data: Uint8Array, offset: number): bigint { return view(data, offset, 8).getBigUint64(0, true); }
function i64(data: Uint8Array, offset: number): bigint { return view(data, offset, 8).getBigInt64(0, true); }
function u128(data: Uint8Array, offset: number): bigint { return u64(data, offset) | (u64(data, offset + 8) << 64n); }
function i128(data: Uint8Array, offset: number): bigint { return BigInt.asIntN(128, u128(data, offset)); }
function key(data: Uint8Array, offset: number): Address { return bytesAddress(data.slice(offset, offset + 32)); }
function min(left: bigint, right: bigint): bigint { return left < right ? left : right; }
function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  if (numerator < 0n || denominator <= 0n) fail("capacity arithmetic invalid");
  return (numerator + denominator - 1n) / denominator;
}

function assertU128(value: bigint): bigint {
  if (value < 0n || value > U128_MAX) fail("capacity arithmetic overflow");
  return value;
}

function rawQuotePerBaseX64(rawPriceX64: bigint, baseIsA: boolean): bigint {
  return baseIsA ? rawPriceX64 : assertU128((Q64 * Q64) / rawPriceX64);
}

/** CLMM range price: 0 when the depth is 0 (not computed), null when it is unrepresentable (SCALE_UNREPRESENTABLE). */
function clmmRangeQuotePerBaseX64(sqrtPrice: bigint, baseIsA: boolean, depth: bigint): bigint | null {
  if (depth === 0n) return 0n;
  try { return rawQuotePerBaseX64(squareQ64ToX64(sqrtPrice), baseIsA); } catch { return null; }
}

function compareAddressBytes(left: Address, right: Address): number {
  const a = addressBytes(left); const b = addressBytes(right);
  for (let index = 0; index < 32; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!;
  }
  return 0;
}

type CapacityAccountRole = "pool" | "base-mint" | "quote-mint" | "base-vault" | "quote-vault" |
  "family-config" | "observation-state" | "clmm-observation" | "open-orders" | "market" | "market-program" |
  "global-config" | "fee-config" | "tick-array" | "bin-array" | "orca-oracle";

interface CapacityAccount extends MimirBetaCapturedAccount {
  readonly role: CapacityAccountRole;
  readonly index?: number;
}

function descriptorForInput(input: MimirBetaCaptureScanDescriptor): MimirBetaCaptureScanDescriptor {
  let serialized: string;
  try { serialized = canonicalJson(input as never); }
  catch { return betaError("UNKNOWN_CAPTURE_DESCRIPTOR", "capture descriptor shape is not canonical"); }
  const matches = ALL_DESCRIPTORS.filter((entry) => entry.descriptorId === input.descriptorId && entry.descriptorHash === input.descriptorHash &&
    canonicalJson(entry as never) === serialized);
  if (matches.length !== 1) betaError("UNKNOWN_CAPTURE_DESCRIPTOR", "capture descriptor is not one exact exported descriptor");
  return matches[0]!;
}

function roleKey(role: CapacityAccountRole, index?: number): string {
  return `${role}:${index === undefined ? "" : index}`;
}

function requiredAccount(
  roles: ReadonlyMap<string, CapacityAccount>,
  role: CapacityAccountRole,
  index?: number,
): CapacityAccount {
  const account = roles.get(roleKey(role, index));
  if (!account) fail(`missing ${role} capacity account`);
  return account;
}

function requireEnvelope(account: CapacityAccount, addressValue: Address, owner: Address, length: number): Uint8Array {
  if (account.address !== addressValue) fail("capacity account address mismatch", account.address);
  if (account.executable) betaError("ACCOUNT_MALFORMED", "capacity data account must not be executable", account.address);
  if (account.owner !== owner) betaError("ACCOUNT_OWNER_MISMATCH", "capacity account owner mismatch", account.address);
  if (account.data.length !== length) betaError("ACCOUNT_MALFORMED", "capacity account allocation mismatch", account.address);
  return account.data;
}

/** @internal Bytes restoring an authenticated venue auxiliary's supported schema (see `requireDiscriminator`'s `auxiliary`). */
export type MimirVenueSchemaRepair = readonly (readonly [offset: number, bytes: Uint8Array])[];

/** `auxiliary`: an authenticated venue auxiliary (canonical address, venue owner, allocation) the program refuses at refresh as
 * `VenueSourceUnavailable`; the error carries `venueSchemaRepair` so an existing feed still plans the row's unchanged vector. */
function requireDiscriminator(data: Uint8Array, discriminator: Uint8Array | null, account: Address, auxiliary = false): void {
  if (discriminator !== null && !bytesEqual(data.subarray(0, discriminator.length), discriminator)) {
    const error = new MimirBetaError("ACCOUNT_MALFORMED", "capacity discriminator mismatch", account);
    throw auxiliary ? Object.assign(error, { venueSchemaRepair: [[0, discriminator]] satisfies MimirVenueSchemaRepair }) : error;
  }
}

function decodeMint(account: CapacityAccount, expected: Address): number {
  const data = requireEnvelope(account, expected, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, 82);
  if (data[45] !== 1 || data[44]! > 18) fail("invalid classic SPL mint", account.address);
  return data[44]!;
}

function decodeVault(account: CapacityAccount, expected: Address, mint: Address, authority: Address): bigint {
  const data = requireEnvelope(account, expected, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, 165);
  const nativeTag = u32(data, 109);
  if (key(data, 0) !== mint || key(data, 32) !== authority || u32(data, 72) !== 0 || (data[108] !== 1 && data[108] !== 2) ||
      (nativeTag !== 0 && !(nativeTag === 1 && mint === SPL_NATIVE_MINT)) || u64(data, 121) !== 0n || u32(data, 129) !== 0) {
    fail("invalid classic SPL vault", account.address);
  }
  const amount = u64(data, 64);
  if (amount === 0n && data[108] === 1) fail("zero vault reserve", account.address);
  return amount;
}

function decodeExtensionFreeMint(account: CapacityAccount, expected: Address): Readonly<{ decimals: number; supply: bigint; program: Address }> {
  if (account.address !== expected || account.executable || account.data.length !== 82 ||
      (account.owner !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID && account.owner !== MIMIR_BETA_TOKEN_2022_PROGRAM_ID)) {
    betaError("ACCOUNT_MALFORMED", "invalid extension-free SPL mint envelope", account.address);
  }
  if (account.data[45] !== 1 || account.data[44]! > 18) fail("invalid extension-free SPL mint", account.address);
  return { decimals: account.data[44]!, supply: u64(account.data, 36), program: account.owner };
}

function decodeExtensionFreeVault(
  account: CapacityAccount,
  expected: Address,
  mint: Address,
  authority: Address,
  tokenProgram: Address,
): bigint {
  const data = requireEnvelope(account, expected, tokenProgram, 165);
  const nativeTag = u32(data, 109);
  if (key(data, 0) !== mint || key(data, 32) !== authority || u32(data, 72) !== 0 || (data[108] !== 1 && data[108] !== 2) ||
      (nativeTag !== 0 && !(tokenProgram === MIMIR_BETA_SPL_TOKEN_PROGRAM_ID && nativeTag === 1 && mint === SPL_NATIVE_MINT)) ||
      u64(data, 121) !== 0n || u32(data, 129) !== 0) fail("invalid extension-free SPL vault", account.address);
  return u64(data, 64);
}

function canonicalBool(data: Uint8Array, offset: number, label: string, account: Address): boolean {
  const value = data[offset];
  if (value !== 0 && value !== 1) fail(`${label} is not a canonical bool`, account);
  return value === 1;
}

function floorDiv(value: number, divisor: number): number {
  if (!Number.isInteger(value) || !Number.isInteger(divisor) || divisor <= 0) fail("invalid signed division");
  let quotient = Math.trunc(value / divisor);
  if (value < 0 && value % divisor !== 0) quotient -= 1;
  return quotient;
}

function checkedTick(value: number): number {
  if (!Number.isInteger(value) || value < -2_147_483_648 || value > 2_147_483_647) fail("tick arithmetic overflow");
  return value;
}

function tickArrayStart(tick: number, spacing: number, size: number): number {
  const span = spacing * size;
  if (!Number.isSafeInteger(span) || span <= 0) fail("tick span invalid");
  return checkedTick(floorDiv(tick, span) * span);
}

function i32Be(value: number): Uint8Array {
  const out = new Uint8Array(4); new DataView(out.buffer).setInt32(0, value, false); return out;
}

function i64Le(value: number): Uint8Array {
  if (!Number.isSafeInteger(value)) fail("bin array index invalid");
  const out = new Uint8Array(8); new DataView(out.buffer).setBigInt64(0, BigInt(value), true); return out;
}

const ED25519_P = (1n << 255n) - 19n;
const ED25519_D = 37095705934669439343138083508754565189542113879843219016388785533085940283555n;
const ED25519_SQRT_M1 = 19681161376707505956807079304988542015446066515923890162744021073123829784752n;

function mod(value: bigint): bigint { const result = value % ED25519_P; return result < 0n ? result + ED25519_P : result; }
function powMod(base: bigint, exponent: bigint): bigint {
  let result = 1n; let factor = mod(base); let remaining = exponent;
  while (remaining > 0n) { if ((remaining & 1n) !== 0n) result = mod(result * factor); factor = mod(factor * factor); remaining >>= 1n; }
  return result;
}

function isEd25519CurvePoint(encoded: Uint8Array): boolean {
  if (encoded.length !== 32) return false;
  const bytes = encoded.slice(); bytes[31] &= 0x7f;
  let y = 0n; for (let index = 31; index >= 0; index -= 1) y = (y << 8n) | BigInt(bytes[index]!);
  if (y >= ED25519_P) return false;
  const y2 = mod(y * y); const denominator = mod(ED25519_D * y2 + 1n);
  if (denominator === 0n) return false;
  const x2 = mod((y2 - 1n) * powMod(denominator, ED25519_P - 2n));
  let root = powMod(x2, (ED25519_P + 3n) / 8n);
  if (mod(root * root) !== x2) root = mod(root * ED25519_SQRT_M1);
  return mod(root * root) === x2;
}

const derivedPdas = new Map<string, readonly [Address, number]>();

function derivePdaSyncWithBump(programId: Address, seeds: readonly Uint8Array[]): readonly [Address, number] {
  if (seeds.length > 16 || seeds.some((seed) => !(seed instanceof Uint8Array) || seed.length > 32)) {
    betaError("INCOMPLETE_CAPTURE_DESCRIPTOR", "capture PDA seeds are invalid");
  }
  const key = JSON.stringify([programId, seeds.map(hex)]);
  const known = derivedPdas.get(key);
  if (known) return known;
  for (let bump = 255; bump >= 0; bump -= 1) {
    const digest = sha256Sync(concatBytes(...seeds.map((seed) => seed.slice()), Uint8Array.of(bump), addressBytes(programId), PDA_MARKER));
    if (!isEd25519CurvePoint(digest)) {
      if (derivedPdas.size >= 4096) derivedPdas.clear();
      const result = Object.freeze([bytesAddress(digest), bump] as const);
      derivedPdas.set(key, result);
      return result;
    }
  }
  return betaError("INCOMPLETE_CAPTURE_DESCRIPTOR", "capture PDA has no viable bump");
}

export function derivePdaSync(programId: Address, seeds: readonly Uint8Array[]): Address {
  return derivePdaSyncWithBump(programId, seeds)[0];
}

function validatePrimaryEligibility(
  descriptor: MimirBetaCaptureScanDescriptor,
  data: Uint8Array,
  context: Readonly<{ observedSlot: bigint; observedUnixTimestamp: bigint }>,
  pool: Address,
): void {
  if (descriptor.status) {
    const status = descriptor.status.acceptedU64 ? u64(data, descriptor.status.offset) : data[descriptor.status.offset]!;
    if (descriptor.status.acceptedU64 ? !descriptor.status.acceptedU64.includes(status as bigint) :
      descriptor.status.disabledMask === undefined ? status !== descriptor.status.enabled : ((status as number) & descriptor.status.disabledMask) !== 0) {
      fail("pool is not active", pool);
    }
  }
  if (descriptor.activation) {
    const point = u64(data, descriptor.activation.offset);
    if (descriptor.activation.typeOffset === undefined) {
      if (point > context.observedUnixTimestamp) fail("pool open time is in the future", pool);
    } else {
      const kind = data[descriptor.activation.typeOffset]!;
      if ((kind === descriptor.activation.slotType && point > context.observedSlot) ||
          (kind === descriptor.activation.timestampType && point > context.observedUnixTimestamp) ||
          (kind !== descriptor.activation.slotType && kind !== descriptor.activation.timestampType)) fail("pool activation is invalid", pool);
    }
  }
}

function captureNode(addressValue: Address, role: MimirBetaCaptureReadNodeRole, index: string | null, pool: Address): MimirBetaCaptureReadNode {
  return { address: addressValue, role, index, derivedFrom: [pool] };
}

export function deriveMimirBetaCaptureReadPlan(input: Readonly<{
  descriptor: MimirBetaCaptureScanDescriptor;
  primary: Readonly<{ address: Address; owner: Address; executable: boolean; data: Uint8Array }>;
  pair: Readonly<{ baseMint: Address; quoteMint: Address }>;
  context: Readonly<{ observedSlot: bigint; observedUnixTimestamp: bigint }>;
  /** See `MimirBetaCaptureCandidateInput.existingFeed`. */
  existingFeed?: boolean;
}>): MimirBetaCaptureReadPlan {
  const descriptor = descriptorForInput(input.descriptor);
  const pool = checkedAddress(input.primary.address, "primary pool");
  const owner = checkedAddress(input.primary.owner, "primary owner");
  const baseMint = checkedAddress(input.pair.baseMint, "base mint");
  const quoteMint = checkedAddress(input.pair.quoteMint, "quote mint");
  if (!(input.primary.data instanceof Uint8Array)) betaError("ACCOUNT_MALFORMED", "primary data must be bytes", pool);
  const data = input.primary.data.slice();
  if (input.primary.executable || owner !== descriptor.programId) betaError("ACCOUNT_OWNER_MISMATCH", "primary owner/executable mismatch", pool);
  if (data.length !== descriptor.allocationSize) betaError("UNKNOWN_CAPTURE_ALLOCATION", "primary allocation does not match bound descriptor", pool);
  requireDiscriminator(data, descriptor.discriminator, pool);
  if (input.context.observedSlot < 0n || input.context.observedUnixTimestamp < 0n) betaError("INVALID_ARGUMENT", "capture context invalid");
  validatePrimaryEligibility(descriptor, data, input.context, pool);
  const mintA = key(data, descriptor.mintAOffset); const mintB = key(data, descriptor.mintBOffset);
  const vaultA = key(data, descriptor.vaultAOffset); const vaultB = key(data, descriptor.vaultBOffset);
  if (baseMint === quoteMint || [baseMint, quoteMint, mintA, mintB, vaultA, vaultB, pool].some((value) => isZeroBytes(addressBytes(value))) ||
      mintA === mintB || vaultA === vaultB || !((mintA === baseMint && mintB === quoteMint) || (mintA === quoteMint && mintB === baseMint))) {
    fail("invalid oriented pool pair", pool);
  }
  if (new Set([pool, mintA, mintB, vaultA, vaultB]).size !== 5) fail("pool/mint/vault address alias", pool);
  const baseIsA = mintA === baseMint; const baseVault = baseIsA ? vaultA : vaultB; const quoteVault = baseIsA ? vaultB : vaultA;
  const canonicalMint0 = compareAddressBytes(mintA, mintB) < 0 ? mintA : mintB;
  const canonicalMint1 = canonicalMint0 === mintA ? mintB : mintA;
  const nodes: MimirBetaCaptureReadNode[] = [
    captureNode(baseMint, "base-mint", null, pool), captureNode(quoteMint, "quote-mint", null, pool),
    captureNode(baseVault, "base-vault", null, pool), captureNode(quoteVault, "quote-vault", null, pool),
  ];
  const rule = descriptor.planRule;
  if (rule.kind === "orca-whirlpool" || rule.kind === "raydium-clmm") {
    const config = key(data, rule.configOffset);
    if (isZeroBytes(addressBytes(config)) || [pool, mintA, mintB, vaultA, vaultB].includes(config)) fail("invalid direct config address", pool);
    if (rule.kind === "orca-whirlpool" && config !== (rule.whirlpoolsConfig ?? MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET)) {
      fail("unsupported Orca Whirlpools config", pool);
    }
    const spacing = u16(data, rule.tickSpacingOffset); const tick = i32(data, rule.tickOffset);
    if (spacing <= 0 || u128(data, rule.kind === "orca-whirlpool" ? 65 : 253) <= 0n) fail("invalid concentrated-liquidity primary state", pool);
    const active = tickArrayStart(tick, spacing, rule.tickArraySize); const span = spacing * rule.tickArraySize;
    const starts = [checkedTick(active - span), active, checkedTick(active + span)];
    nodes.push(captureNode(config, rule.kind === "orca-whirlpool" ? "whirlpools-config" : "amm-config", null, pool));
    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]!;
      const derived = derivePdaSync(descriptor.programId, [utf8("tick_array"), addressBytes(pool),
        rule.kind === "orca-whirlpool" ? utf8(start.toString()) : i32Be(start)]);
      nodes.push(captureNode(derived, (["tick-array-lower", "tick-array-active", "tick-array-upper"] as const)[index]!, start.toString(), pool));
    }
    if (rule.kind === "orca-whirlpool" && mimirOrcaAdaptive(data) && input.existingFeed !== true) {
      nodes.push(captureNode(derivePdaSync(descriptor.programId, [utf8("oracle"), addressBytes(pool)]), "orca-oracle", null, pool));
    }
    if (rule.kind === "raydium-clmm") {
      const observation = key(data, rule.observationOffset);
      if (isZeroBytes(addressBytes(observation)) ||
          [pool, mintA, mintB, vaultA, vaultB, config].includes(observation)) {
        betaError("PDA_MISMATCH", "Raydium CLMM observation pointer is missing or aliases pool accounts", observation);
      }
      nodes.push(captureNode(observation, "clmm-observation", null, pool));
    }
  } else if (rule.kind === "raydium-cpmm") {
    const config = key(data, rule.configOffset); const observation = key(data, rule.observationOffset);
    if ([config, observation].some((value) => isZeroBytes(addressBytes(value))) || config === observation ||
        [pool, mintA, mintB, vaultA, vaultB].some((value) => value === config || value === observation)) {
      betaError("INCOMPLETE_CAPTURE_DESCRIPTOR", "CPMM direct config/observation relation is invalid", pool);
    }
    const derivedObservation = derivePdaSync(descriptor.programId, [utf8("observation"), addressBytes(pool)]);
    if (derivedObservation !== observation) betaError("PDA_MISMATCH", "CPMM observation PDA mismatch", observation);
    nodes.push(captureNode(config, "amm-config", null, pool), captureNode(observation, "cpmm-observation", null, pool));
  } else if (rule.kind === "raydium-amm-v4") {
    const rawOpenOrders = key(data, rule.openOrdersOffset); const market = key(data, rule.marketOffset);
    const marketProgram = key(data, rule.marketProgramOffset);
    const openOrders = isZeroBytes(addressBytes(rawOpenOrders)) ? SYSTEM_PROGRAM_ID : rawOpenOrders;
    if (isZeroBytes(addressBytes(market)) || !ammV4MarketProgramOk(descriptor.programId, marketProgram) ||
        new Set([pool, mintA, mintB, vaultA, vaultB, openOrders, market, marketProgram]).size !== 8) {
      fail("invalid AMM-v4 venue closure", pool);
    }
    nodes.push(captureNode(openOrders, "open-orders", null, pool), captureNode(market, "market", null, pool),
      captureNode(marketProgram, "market-program", null, pool));
  } else if (rule.kind === "pumpswap") {
    const indexBytes = data.slice(9, 11); const creator = key(data, 11);
    const [derivedPool, bump] = derivePdaSyncWithBump(descriptor.programId,
      [utf8("pool"), indexBytes, addressBytes(creator), addressBytes(mintA), addressBytes(mintB)]);
    if (derivedPool !== pool || data[8] !== bump) betaError("PDA_MISMATCH", "PumpSwap pool PDA/bump mismatch", pool);
    const expectedLp = derivePdaSync(descriptor.programId, [utf8("pool_lp_mint"), addressBytes(pool)]);
    if (key(data, 107) !== expectedLp) betaError("PDA_MISMATCH", "PumpSwap LP mint PDA mismatch", pool);
    const globalConfig = derivePdaSync(descriptor.programId, [utf8("global_config")]);
    const feeConfig = derivePdaSync(PUMP_FEE_PROGRAM_ID, [utf8("fee_config"), addressBytes(descriptor.programId)]);
    nodes.push(captureNode(globalConfig, "global-config", null, pool), captureNode(feeConfig, "fee-config", null, pool));
  } else if (rule.kind === "meteora-dlmm") {
    const active = i32(data, rule.activeIdOffset); const step = u16(data, rule.binStepOffset);
    if (step <= 0 || step > 400) fail("invalid DLMM bin step", pool);
    const window = Math.ceil(rule.depthBps / step); const lower = checkedTick(active - window); const upper = checkedTick(active + window);
    const lowerIndex = floorDiv(lower, rule.binsPerArray); const upperIndex = floorDiv(upper, rule.binsPerArray);
    for (let index = lowerIndex; index <= upperIndex; index += 1) {
      nodes.push(captureNode(derivePdaSync(descriptor.programId, [utf8("bin_array"), addressBytes(pool), i64Le(index)]),
        "depth-bin-array", index.toString(), pool));
    }
  } else if (rule.kind === "meteora-damm-v2") {
    if (u128(data, 456) <= 0n) fail("invalid DAMM-v2 primary curve state", pool);
  } else {
    betaError("INCOMPLETE_CAPTURE_DESCRIPTOR", "unsupported capture plan rule", pool);
  }
  if (nodes.length > descriptor.maxAuxiliaryAccounts) betaError("INCOMPLETE_CAPTURE_DESCRIPTOR", "capture auxiliary bound exceeded", pool);
  nodes.sort((left, right) => compareAddressBytes(left.address, right.address) || compareAscii(left.role, right.role) || compareAscii(left.index ?? "", right.index ?? ""));
  const nodeAddresses = nodes.map((node) => node.address);
  if (new Set([pool, ...nodeAddresses]).size !== nodeAddresses.length + 1) fail("duplicate capture plan address", pool);
  const allAddresses = [pool, ...nodeAddresses].sort(compareAddressBytes);
  const context = { observedSlot: input.context.observedSlot, observedUnixTimestamp: input.context.observedUnixTimestamp };
  const primaryDataSha256 = hex(sha256Sync(data));
  const fields = {
    schema: "mimir-beta-capture-read-plan-v1" as const, descriptorId: descriptor.descriptorId, descriptorHash: descriptor.descriptorHash,
    family: descriptor.family, program: descriptor.programId, pool, baseMint, quoteMint, canonicalMint0, canonicalMint1,
    canonicalPairKey: `${canonicalMint0}:${canonicalMint1}`, direction: "quote-per-base" as const, baseVault, quoteVault,
    context, auxiliary: nodes.map((node) => ({ ...node, derivedFrom: [...node.derivedFrom] })), allAddresses,
  };
  const eligibility = {
    status: descriptor.status ? (descriptor.status.acceptedU64 ? u64(data, descriptor.status.offset) : data[descriptor.status.offset]!) : null,
    activation: descriptor.activation ? {
      point: u64(data, descriptor.activation.offset),
      type: descriptor.activation.typeOffset === undefined ? null : data[descriptor.activation.typeOffset]!,
    } : null,
  };
  const planHash = syncDomainHash("MIMIR_BETA_CAPTURE_READ_PLAN_V1\0", canonicalJson({ ...fields, eligibility } as never));
  return Object.freeze({ ...fields, primaryDataSha256, context: Object.freeze(context), auxiliary: Object.freeze(fields.auxiliary.map((node) => Object.freeze({
    ...node, derivedFrom: Object.freeze([...node.derivedFrom]),
  }))), allAddresses: Object.freeze([...allAddresses]), planHash });
}

async function requirePda(programId: Address, seeds: readonly Uint8Array[], expected: Address): Promise<void> {
  const [derived] = await getProgramDerivedAddressCached(programId, seeds);
  if (derived !== expected) betaError("PDA_MISMATCH", "capacity account PDA mismatch", expected);
}

export function clmmSqrtPriceX64FromTickIndex(tickIndex: number): bigint {
  if (!Number.isInteger(tickIndex) || tickIndex < -443_636 || tickIndex > 443_636) fail("CLMM tick out of range");
  const absTick = Math.abs(tickIndex);
  let ratio = (absTick & 1) !== 0 ? 0xfffcb933bd6fad37aa2d162d1a594001n : 0x100000000000000000000000000000000n;
  const multiply = (bit: number, factor: bigint): void => { if ((absTick & bit) !== 0) ratio = (ratio * factor) >> 128n; };
  multiply(0x2, 0xfff97272373d413259a46990580e213an); multiply(0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  multiply(0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n); multiply(0x10, 0xffcb9843d60f6159c9db58835c926644n);
  multiply(0x20, 0xff973b41fa98c081472e6896dfb254c0n); multiply(0x40, 0xff2ea16466c96a3843ec78b326b52861n);
  multiply(0x80, 0xfe5dee046a99a2a811c461f1969c3053n); multiply(0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  multiply(0x200, 0xf987a7253ac413176f2b074cf7815e54n); multiply(0x400, 0xf3392b0822b70005940c7a398e4b70f3n);
  multiply(0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n); multiply(0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  multiply(0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n); multiply(0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n);
  multiply(0x8000, 0x31be135f97d08fd981231505542fcfa6n); multiply(0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  multiply(0x20000, 0x5d6af8dedb81196699c329225ee604n); multiply(0x40000, 0x2216e584f5fa1ea926041bedfe98n);
  if (tickIndex > 0) ratio = U256_MAX / ratio;
  return assertU128(ratio >> 64n);
}

export function orcaSqrtPriceX64FromTickIndex(tickIndex: number): bigint {
  if (!Number.isInteger(tickIndex) || tickIndex < -443_636 || tickIndex > 443_636) fail("Orca tick out of range");
  const tick = Math.abs(tickIndex);
  const positive = tickIndex > 0;
  const shift = positive ? 96n : 64n;
  const factors = positive ? [
    79232123823359799118286999567n, 79236085330515764027303304731n, 79244008939048815603706035061n,
    79259858533276714757314932305n, 79291567232598584799939703904n, 79355022692464371645785046466n,
    79482085999252804386437311141n, 79736823300114093921829183326n, 80248749790819932309965073892n,
    81282483887344747381513967011n, 83390072131320151908154831281n, 87770609709833776024991924138n,
    97234110755111693312479820773n, 119332217159966728226237229890n, 179736315981702064433883588727n,
    407748233172238350107850275304n, 2098478828474011932436660412517n, 55581415166113811149459800483533n,
    38992368544603139932233054999993551n,
  ] : [
    18445821805675392311n, 18444899583751176498n, 18443055278223354162n, 18439367220385604838n,
    18431993317065449817n, 18417254355718160513n, 18387811781193591352n, 18329067761203520168n,
    18212142134806087854n, 17980523815641551639n, 17526086738831147013n, 16651378430235024244n,
    15030750278693429944n, 12247334978882834399n, 8131365268884726200n, 3584323654723342297n,
    696457651847595233n, 26294789957452057n, 37481735321082n,
  ];
  let ratio = (tick & 1) !== 0 ? factors[0]! : 1n << shift;
  for (let bit = 1; bit < factors.length; bit += 1) if ((tick & (1 << bit)) !== 0) ratio = (ratio * factors[bit]!) >> shift;
  return positive ? ratio >> 32n : ratio;
}

export function raydiumSqrtPriceX64FromTickIndex(tickIndex: number): bigint {
  if (!Number.isInteger(tickIndex) || tickIndex < -443_636 || tickIndex > 443_636) fail("Raydium CLMM tick out of range");
  const tick = Math.abs(tickIndex);
  const factors = [
    0xfffcb933bd6fb800n, 0xfff97272373d4000n, 0xfff2e50f5f657000n, 0xffe5caca7e10f000n, 0xffcb9843d60f7000n,
    0xff973b41fa98e800n, 0xff2ea16466c9b000n, 0xfe5dee046a9a3800n, 0xfcbe86c7900bb000n, 0xf987a7253ac65800n,
    0xf3392b0822bb6000n, 0xe7159475a2caf000n, 0xd097f3bdfd2f2000n, 0xa9f746462d9f8000n, 0x70d869a156f31c00n,
    0x31be135f97ed3200n, 0x9aa508b5b85a500n, 0x5d6af8dedc582cn, 0x2216e584f5fan,
  ];
  let ratio = (tick & 1) !== 0 ? factors[0]! : 1n << 64n;
  for (let bit = 1; bit < factors.length; bit += 1) if ((tick & (1 << bit)) !== 0) ratio = (ratio * factors[bit]!) >> 64n;
  return tickIndex > 0 ? U128_MAX / ratio : ratio;
}

function firstDownTick(current: number, spacing: number): number { return floorDiv(current, spacing) * spacing; }
function firstUpTick(current: number, spacing: number): number {
  const floor = firstDownTick(current, spacing); return checkedTick(floor === current ? floor + spacing : floor + spacing);
}

const CLMM_MIN_TICK = -443_636; const CLMM_MAX_TICK = 443_636;
/** Program `clmm_tick_array_start_is_valid`: in the venue domain, or the partial bottom array. */
const clmmTickArrayStartValid = (start: number, span: number) =>
  start <= CLMM_MAX_TICK && ((start >= CLMM_MIN_TICK && start % span === 0) || start === Math.floor(CLMM_MIN_TICK / span) * span);

/** A window role: the exact PDA, absent (System, empty, non-executable) when outside the venue domain; the active array must be in it. */
function clmmBoundaryRole(account: CapacityAccount, start: number, span: number, active: boolean, pool: Address): boolean {
  const valid = clmmTickArrayStartValid(start, span);
  if (active && !valid) fail("CLMM active tick array outside the venue domain", pool);
  const absent = account.owner === SYSTEM_PROGRAM_ID && !account.executable && account.data.length === 0;
  if (!valid && !absent) fail("CLMM out-of-domain tick array must be absent", account.address);
  return absent;
}

function clmmDepth(args: {
  currentTick: number; spacing: number; liquidity: bigint; sqrtPrice: bigint; token0IsBase: boolean;
  liquidityNet(tick: number): bigint;
}): bigint {
  // Match processor min-liquidity crossings and core math's conservative rounding.
  const maxLiquidity = (1n << 127n) - 1n;
  if (args.liquidity < 0n || args.liquidity > maxLiquidity) fail("CLMM liquidity outside i128");
  const delta = 50;
  if (args.currentTick - delta < CLMM_MIN_TICK || args.currentTick + delta > CLMM_MAX_TICK) return 0n;
  let minimum = args.liquidity;
  for (const direction of [-1, 1] as const) {
    let running = args.liquidity;
    const limit = checkedTick(args.currentTick + direction * delta);
    let tick = direction === -1 ? firstDownTick(args.currentTick, args.spacing) : firstUpTick(args.currentTick, args.spacing);
    for (; direction === -1 ? tick >= limit : tick <= limit; tick = checkedTick(tick + direction * args.spacing)) {
      running += BigInt(direction) * args.liquidityNet(tick);
      if (running < 0n || running > maxLiquidity) fail("CLMM crossing liquidity outside i128");
      minimum = min(minimum, running);
      if (tick === limit) break;
    }
  }
  if (minimum === 0n) return 0n;
  const targetDown = assertU128(ceilDiv(args.sqrtPrice * (SQRT_DOWN_50_BPS_X64 + 1n), Q64));
  const targetUp = assertU128((args.sqrtPrice * (SQRT_UP_50_BPS_X64 - 1n)) / Q64);
  if (targetDown >= args.sqrtPrice || targetUp <= args.sqrtPrice || targetDown <= 0n) fail("invalid CLMM depth window");
  const q128 = Q64 * Q64;
  const inverseDown = assertU128(q128 / targetDown);
  const inverseCurrent = assertU128(ceilDiv(q128, args.sqrtPrice));
  if (inverseDown < inverseCurrent) fail("invalid CLMM inverse depth window");
  const amountB = assertU128((minimum * (targetUp - args.sqrtPrice)) / Q64);
  const amountA = assertU128((minimum * (inverseDown - inverseCurrent)) / Q64);
  const priceFloor = assertU128((args.sqrtPrice * args.sqrtPrice) / Q64);
  const priceCeil = assertU128(ceilDiv(args.sqrtPrice * args.sqrtPrice, Q64));
  if (priceFloor === 0n || priceCeil === 0n) fail("zero CLMM price");
  const inversePriceFloor = assertU128(q128 / priceCeil);
  const upQuote = args.token0IsBase ? amountB : assertU128((amountB * inversePriceFloor) / Q64);
  const downQuote = args.token0IsBase ? assertU128((amountA * priceFloor) / Q64) : amountA;
  return assertU128(min(upQuote, downQuote));
}

export function validateSqrtTick(
  sqrtPrice: bigint, currentTick: number, tickToSqrt: (tick: number) => bigint = clmmSqrtPriceX64FromTickIndex,
): void {
  const lower = tickToSqrt(currentTick);
  const upper = currentTick === 443_636 ? U128_MAX : tickToSqrt(currentTick + 1);
  if (sqrtPrice < lower || sqrtPrice > upper) fail("CLMM sqrt price/tick mismatch");
}

function legacyOrcaLiquidityNet(data: Uint8Array, start: number, spacing: number, tick: number): bigint {
  const index = (tick - start) / spacing;
  if (!Number.isInteger(index) || index < 0 || index >= 88) fail("Orca tick outside supplied arrays");
  const offset = 12 + index * 113;
  return data[offset] === 0 ? 0n : i128(data, offset + 1);
}

function dynamicOrcaLiquidityNet(data: Uint8Array, start: number, spacing: number, tick: number): bigint {
  const index = (tick - start) / spacing;
  if (!Number.isInteger(index) || index < 0 || index >= 88) fail("Orca dynamic tick outside supplied arrays");
  const bitmap = u128(data, 44);
  if ((bitmap & (1n << BigInt(index))) === 0n) return 0n;
  let offset = 60;
  for (let cursor = 0; cursor < index; cursor += 1) offset += (bitmap & (1n << BigInt(cursor))) === 0n ? 1 : 113;
  return i128(data, offset + 1);
}

/** Orca adaptive-fee pool: `tick_spacing_seed` (u16 @43) differs from `tick_spacing` (u16 @41). */
export function mimirOrcaAdaptive(pool: Uint8Array): boolean { return u16(pool, 43) !== u16(pool, 41); }

/**
 * CREATE admission of an adaptive Orca pool: its canonical Oracle `["oracle", pool]` (Orca-owned, 254 bytes, Oracle discriminator,
 * embedded pool @8) and `trade_enable_timestamp` (u64 @40) ≤ the authentic Clock `nowUnix`; a future enablement is `POOL_INELIGIBLE`.
 */
export function mimirOrcaAdmissionOracle(oracle: MimirBetaCapturedAccount | null | undefined, pool: Address, program: Address, nowUnix: bigint): void {
  const expected = derivePdaSync(program, [utf8("oracle"), addressBytes(pool)]);
  if (!oracle) betaError("ACCOUNT_MALFORMED", "Orca adaptive Oracle is missing", expected);
  if (oracle.address !== expected) betaError("PDA_MISMATCH", "Orca Oracle PDA mismatch", oracle.address);
  const data = requireEnvelope({ ...oracle, role: "orca-oracle" }, expected, program, 254);
  requireDiscriminator(data, Uint8Array.of(139, 194, 131, 179, 140, 179, 229, 244), expected);
  if (key(data, 8) !== pool) betaError("ACCOUNT_MALFORMED", "Orca Oracle whirlpool mismatch", expected);
  if (u64(data, 40) > nowUnix) fail("Orca adaptive pool trading is not enabled yet (future trade_enable_timestamp)", pool);
}

async function decodeOrca(
  program: Address, roles: ReadonlyMap<string, CapacityAccount>, pool: Address, data: Uint8Array, baseIsA: boolean, now: bigint,
): Promise<{ authority: Address; config: Address; depth: bigint; rawQuotePerBaseX64: bigint | null }> {
  if (roles.has(roleKey("orca-oracle"))) mimirOrcaAdmissionOracle(roles.get(roleKey("orca-oracle")), pool, program, now);
  const config = key(data, 8);
  if (isZeroBytes(addressBytes(config))) fail("invalid Orca config address", pool);
  const configData = requireEnvelope(requiredAccount(roles, "family-config"), config, program, 108);
  requireDiscriminator(configData, Uint8Array.of(157, 20, 49, 224, 217, 87, 193, 254), config);
  const spacing = u16(data, 41); const liquidity = u128(data, 49); const sqrtPrice = u128(data, 65); const currentTick = i32(data, 81);
  if (spacing <= 0 || sqrtPrice <= 0n) fail("invalid Orca capacity state", pool);
  validateSqrtTick(sqrtPrice, currentTick, orcaSqrtPriceX64FromTickIndex);
  const activeStart = tickArrayStart(currentTick, spacing, 88); const span = spacing * 88;
  const starts = [checkedTick(activeStart - span), activeStart, checkedTick(activeStart + span)];
  const arrays = new Map<number, Uint8Array>();
  for (const start of starts) {
    const account = requiredAccount(roles, "tick-array", start);
    await requirePda(program, [utf8("tick_array"), addressBytes(pool), utf8(start.toString())], account.address);
    if (clmmBoundaryRole(account, start, span, start === activeStart, pool)) {
      arrays.set(start, account.data);
      continue;
    }
    if (account.owner !== program) betaError("ACCOUNT_OWNER_MISMATCH", "Orca tick owner mismatch", account.address);
    const discriminator = account.data.subarray(0, 8);
    if (bytesEqual(discriminator, Uint8Array.of(69, 97, 189, 190, 110, 7, 66, 187))) {
      if (account.data.length !== 9_988 || i32(account.data, 8) !== start || key(account.data, 9_956) !== pool) fail("invalid Orca tick array", account.address);
    } else if (bytesEqual(discriminator, Uint8Array.of(17, 216, 246, 142, 225, 199, 218, 56))) {
      const bitmap = u128(account.data, 44); let initialized = 0;
      for (let cursor = 0; cursor < 88; cursor += 1) if ((bitmap & (1n << BigInt(cursor))) !== 0n) initialized += 1;
      if (account.data.length !== 60 + 88 + initialized * 112 || i32(account.data, 8) !== start || key(account.data, 12) !== pool) fail("invalid Orca dynamic tick array", account.address);
    } else fail("invalid Orca tick discriminator", account.address);
    arrays.set(start, account.data);
  }
  const readNet = (tick: number): bigint => {
    const start = tickArrayStart(tick, spacing, 88); const array = arrays.get(start);
    if (!array) fail("Orca tick closure incomplete", pool);
    if (array.length === 0) return 0n;
    return bytesEqual(array.subarray(0, 8), Uint8Array.of(17, 216, 246, 142, 225, 199, 218, 56))
      ? dynamicOrcaLiquidityNet(array, start, spacing, tick)
      : legacyOrcaLiquidityNet(array, start, spacing, tick);
  };
  const depth = clmmDepth({ currentTick, spacing, liquidity, sqrtPrice, token0IsBase: baseIsA, liquidityNet: readNet });
  return { authority: pool, config, depth, rawQuotePerBaseX64: clmmRangeQuotePerBaseX64(sqrtPrice, baseIsA, depth) };
}

async function decodeRaydiumClmm(
  program: Address, roles: ReadonlyMap<string, CapacityAccount>, pool: Address, data: Uint8Array, baseIsA: boolean, now: bigint,
): Promise<{ authority: Address; config: Address; depth: bigint; rawQuotePerBaseX64: bigint | null }> {
   const config = key(data, 9);
  const configData = requireEnvelope(requiredAccount(roles, "family-config"), config, program, 117);
  requireDiscriminator(configData, AMM_CONFIG_DISCRIMINATOR, config);
  const observation = key(data, 201);
  const observationData = requireEnvelope(requiredAccount(roles, "clmm-observation"), observation, program, 4_483);
  requireDiscriminator(observationData, Uint8Array.of(122, 174, 197, 53, 129, 9, 165, 132), observation, true);
  parseRaydiumClmmNativeTwapObservationState({ observationState: observationData,
    expectedPoolState: addressBytes(pool), currentTimestamp: now });
  const spacing = u16(data, 235); const liquidity = u128(data, 237); const sqrtPrice = u128(data, 253); const currentTick = i32(data, 269);
  if (spacing <= 0 || u16(configData, 51) !== spacing || sqrtPrice <= 0n) fail("invalid Raydium CLMM capacity state", pool);
  validateSqrtTick(sqrtPrice, currentTick, raydiumSqrtPriceX64FromTickIndex);
  const activeStart = tickArrayStart(currentTick, spacing, 60); const span = spacing * 60;
  const starts = [checkedTick(activeStart - span), activeStart, checkedTick(activeStart + span)];
  const arrays = new Map<number, Uint8Array>();
  for (const start of starts) {
    const account = requiredAccount(roles, "tick-array", start);
    await requirePda(program, [utf8("tick_array"), addressBytes(pool), i32Be(start)], account.address);
    if (clmmBoundaryRole(account, start, span, start === activeStart, pool)) {
      arrays.set(start, account.data);
      continue;
    }
    const tickData = requireEnvelope(account, account.address, program, 10_240);
    requireDiscriminator(tickData, Uint8Array.of(192, 155, 85, 205, 49, 249, 129, 42), account.address, true);
    if (key(tickData, 8) !== pool || i32(tickData, 40) !== start) fail("invalid Raydium CLMM tick relation", account.address);
    arrays.set(start, tickData);
  }
  const readNet = (tick: number): bigint => {
    const start = tickArrayStart(tick, spacing, 60); const array = arrays.get(start);
    if (!array) fail("Raydium CLMM tick closure incomplete", pool);
    const index = (tick - start) / spacing; if (!Number.isInteger(index) || index < 0 || index >= 60) fail("Raydium CLMM tick index invalid", pool);
    if (array.length === 0) return 0n;
    const offset = 44 + index * 168; const gross = u128(array, offset + 20);
    if (gross === 0n) return 0n;
    if (i32(array, offset) !== tick) fail("Raydium CLMM stored tick mismatch", pool);
    return i128(array, offset + 4);
  };
  const depth = clmmDepth({ currentTick, spacing, liquidity, sqrtPrice, token0IsBase: baseIsA, liquidityNet: readNet });
  return { authority: pool, config, depth, rawQuotePerBaseX64: clmmRangeQuotePerBaseX64(sqrtPrice, baseIsA, depth) };
}

async function decodeRaydiumCpmm(
  program: Address, roles: ReadonlyMap<string, CapacityAccount>, pool: Address, data: Uint8Array, baseIsA: boolean,
): Promise<{ authority: Address; config: Address; observation: Address; baseFees: bigint; quoteFees: bigint; depth(base: bigint, quote: bigint): bigint }> {
   const config = key(data, 8); const observation = key(data, 296);
  if (key(data, 232) !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID || key(data, 264) !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID) fail("unsupported CPMM token program", pool);
  const configData = requireEnvelope(requiredAccount(roles, "family-config"), config, program, 236);
  requireDiscriminator(configData, AMM_CONFIG_DISCRIMINATOR, config);
  const observationData = requireEnvelope(requiredAccount(roles, "observation-state"), observation, program, 4_075);
  requireDiscriminator(observationData, Uint8Array.of(122, 174, 197, 53, 129, 9, 165, 132), observation, true);
  if (observationData[8] === 0 || key(observationData, 11) !== pool) fail("invalid CPMM observation state", observation);
  await requirePda(program, [utf8("observation"), addressBytes(pool)], observation);
  const [authority] = await getProgramDerivedAddressCached(program, [utf8("vault_and_lp_mint_auth_seed")]);
  const feeTotal = (offsets: readonly number[]): bigint => {
    const total = offsets.reduce((sum, offset) => sum + u64(data, offset), 0n);
    if (total > U64_MAX) fail("CPMM fee counter overflow", pool); return total;
  };
  const feesA = feeTotal([341, 357, 397]); const feesB = feeTotal([349, 365, 405]);
  return {
    authority, config, observation,
    baseFees: baseIsA ? feesA : feesB, quoteFees: baseIsA ? feesB : feesA,
    depth: (base, quote) => cpmmZeroFeeImmediateUnwindBounds(base, quote, 50).capitalRequiredFloor,
  };
}

function decodeRaydiumAmmV4(
  ammProgram: Address, roles: ReadonlyMap<string, CapacityAccount>, pool: Address, data: Uint8Array, baseIsA: boolean,
  baseDecimals: number, quoteDecimals: number,
): Readonly<{ authority: Address; baseReserve: bigint; quoteReserve: bigint; depth: bigint; pointOnly: boolean }> {
  const vaultAuthority = derivePdaSync(ammProgram, [utf8("amm authority")]);
  const poolBaseDecimals = u64(data, 32); const poolQuoteDecimals = u64(data, 40);
  if (poolBaseDecimals > 18n || poolQuoteDecimals > 18n ||
      Number(baseIsA ? poolBaseDecimals : poolQuoteDecimals) !== baseDecimals ||
      Number(baseIsA ? poolQuoteDecimals : poolBaseDecimals) !== quoteDecimals) fail("AMM-v4 mint decimals mismatch", pool);
  const feeNumerator = u64(data, 176); const feeDenominator = u64(data, 184);
  if (feeNumerator >= feeDenominator) fail("AMM-v4 trade fee is invalid", pool);
  if (!Object.values(MIMIR_BETA_CLUSTER_TABLES).some((table) => table.venuePrograms["raydium-amm-v4"] === ammProgram &&
    table.ammV4AdministrativeOwner === key(data, 688))) fail("AMM-v4 authority mismatch", pool);
  const marketProgram = key(data, 560); const market = key(data, 528); const rawOpenOrders = key(data, 496);
  const programAccount = requiredAccount(roles, "market-program");
  if (programAccount.address !== marketProgram || !programAccount.executable ||
      !ammV4MarketProgramOk(ammProgram, marketProgram)) {
    betaError("ACCOUNT_MALFORMED", "AMM-v4 market program is invalid", marketProgram);
  }
  const marketAccount = requiredAccount(roles, "market");
  if (marketAccount.address !== market || marketAccount.executable || marketAccount.owner !== marketProgram || marketAccount.data.length === 0) {
    betaError("ACCOUNT_MALFORMED", "AMM-v4 market account is invalid", market);
  }
  const openOrders = requiredAccount(roles, "open-orders"); let openBase = 0n; let openQuote = 0n;
  if (isZeroBytes(addressBytes(rawOpenOrders))) {
    if (openOrders.address !== SYSTEM_PROGRAM_ID || !openOrders.executable) {
      betaError("ACCOUNT_MALFORMED", "AMM-v4 zero open-orders sentinel is invalid", openOrders.address);
    }
  } else {
    const open = requireEnvelope(openOrders, rawOpenOrders, marketProgram, 3_228);
    if (key(open, 13) !== market || key(open, 45) !== vaultAuthority) fail("AMM-v4 open-orders relation mismatch", rawOpenOrders);
    openBase = u64(open, 85); openQuote = u64(open, 101);
  }
  const poolBaseVault = decodeVault(requiredAccount(roles, baseIsA ? "base-vault" : "quote-vault"),
    baseIsA ? key(data, 336) : key(data, 336), key(data, 400), vaultAuthority);
  const poolQuoteVault = decodeVault(requiredAccount(roles, baseIsA ? "quote-vault" : "base-vault"),
    baseIsA ? key(data, 368) : key(data, 368), key(data, 432), vaultAuthority);
  const basePnl = u64(data, 192); const quotePnl = u64(data, 200);
  const poolBaseGross = poolBaseVault + openBase; const poolQuoteGross = poolQuoteVault + openQuote;
  if (poolBaseGross > U128_MAX || poolQuoteGross > U128_MAX || poolBaseGross <= basePnl || poolQuoteGross <= quotePnl) {
    fail("AMM-v4 corrected reserve underflow", pool);
  }
  const poolBase = poolBaseGross - basePnl; const poolQuote = poolQuoteGross - quotePnl;
  const baseReserve = baseIsA ? poolBase : poolQuote; const quoteReserve = baseIsA ? poolQuote : poolBase;
  return { authority: vaultAuthority, baseReserve, quoteReserve,
    ...pointDepth(baseReserve, quoteReserve, feeNumerator * 1_000_000n / feeDenominator) };
}

function pointDepth(baseReserve: bigint, quoteReserve: bigint, feePpm: bigint): Readonly<{ depth: bigint; pointOnly: boolean }> {
  const depth = cpmmZeroFeeImmediateUnwindBounds(baseReserve, quoteReserve, 50).capitalRequiredFloor;
  const feeProduct = depth * feePpm;
  return { depth, pointOnly: depth === 0n || feeProduct > U128_MAX || feeProduct / 1_000_000n === 0n };
}

type PumpFees = Readonly<{ lp: bigint; protocol: bigint; creator: bigint }>;

function checkedPumpFees(fees: PumpFees, label: string, account: Address): PumpFees {
  if ([fees.lp, fees.protocol, fees.creator].some((value) => value > 10_000n) || fees.lp + fees.protocol + fees.creator > 10_000n) {
    fail(`${label} fee tuple is invalid`, account);
  }
  return fees;
}

function decodePumpFeeConfig(data: Uint8Array, account: Address, expectedBump: number): Readonly<{
  flat: PumpFees; regular: readonly Readonly<{ threshold: bigint; fees: PumpFees }>[];
  stable: readonly Readonly<{ threshold: bigint; fees: PumpFees }>[]; exotic: PumpFees;
}> {
  requireDiscriminator(data, Uint8Array.of(143, 52, 146, 187, 219, 123, 76, 155), account);
  if (data.length < 73 || data[8] !== expectedBump || isZeroBytes(data.subarray(9, 41))) fail("Pump fee config header is invalid", account);
  let offset = 41;
  const fees = (label: string): PumpFees => {
    const value = checkedPumpFees({ lp: u64(data, offset), protocol: u64(data, offset + 8), creator: u64(data, offset + 16) }, label, account);
    offset += 24; return value;
  };
  const flat = fees("Pump flat"); const vector = (label: string, minimum: number): readonly Readonly<{ threshold: bigint; fees: PumpFees }>[] => {
    const count = u32(data, offset); offset += 4;
    if (count < minimum || count > 32) fail(`${label} tier count is invalid`, account);
    const rows: { threshold: bigint; fees: PumpFees }[] = [];
    for (let index = 0; index < count; index += 1) {
      if (offset + 40 > data.length) fail(`${label} tier vector is truncated`, account);
      const threshold = u128(data, offset); offset += 16; const rowFees = fees(`${label} tier`);
      if (index > 0 && threshold <= rows[index - 1]!.threshold) fail(`${label} thresholds are not strictly ascending`, account);
      rows.push({ threshold, fees: rowFees });
    }
    return rows;
  };
  const regular = vector("Pump regular", 1); const stable = vector("Pump stable", 0);
  let exotic: PumpFees = { lp: 0n, protocol: 0n, creator: 0n };
  if (data.length === 4_097) exotic = fees("Pump exotic");
  // Pump's recognized allocation keeps a zero-filled reserve after the serialized config.
  if (offset !== data.length &&
      !((data.length === 4_073 || data.length === 4_097) && isZeroBytes(data.subarray(offset)))) {
    fail("Pump fee config has trailing bytes", account);
  }
  return { flat, regular, stable, exotic };
}

function decodePumpSwap(
  roles: ReadonlyMap<string, CapacityAccount>, pool: Address, data: Uint8Array, baseIsA: boolean,
): Readonly<{ authority: Address; tokenProgram: Address; baseDecimals: number; quoteDecimals: number;
  baseReserve: bigint; quoteReserve: bigint; depth: bigint; adapterVersion: MimirBetaAdapterVersion; token2022Mint: Address | null;
  pointOnly: boolean; effectiveQuote: bigint; quoteTokenProgram: Address; conditions: number; powersMask: number }> {
  const program = PROGRAMS.pumpswap; const poolBaseMint = key(data, 43); const poolQuoteMint = key(data, 75);
  const baseMintAccount = requiredAccount(roles, baseIsA ? "base-mint" : "quote-mint");
  const quoteMintAccount = requiredAccount(roles, baseIsA ? "quote-mint" : "base-mint");
  const sourceBaseMintAccount = requiredAccount(roles, "base-mint");
  const sourceQuoteMintAccount = requiredAccount(roles, "quote-mint");
  const token2022Base = sourceBaseMintAccount.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID;
  if (sourceQuoteMintAccount.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID || (token2022Base && !baseIsA)) {
    betaError("TOKEN_PROGRAM_PAIR_UNSUPPORTED", "PumpSwap Token-2022 mint must be the direct source base", pool);
  }
  const sourceBaseVault = requiredAccount(roles, "base-vault");
  const extendedToken2022 = token2022Base && (sourceBaseMintAccount.data.length !== 82 || sourceBaseVault.data.length !== 165);
  const token2022Policy = <T>(run: () => T): T => {
    try { return run(); }
    catch (error) {
      if (isToken2022ClmmAccountError(error)) betaError("ACCOUNT_MALFORMED", error.message, pool);
      if (isToken2022ClmmPolicyError(error)) betaError(error.code, error.message, pool);
      throw error;
    }
  };
  let conditions = 0; let powersMask = 0;
  const poolBase = token2022Base && sourceBaseMintAccount.data.length !== 82
    ? token2022Policy(() => {
        const parsed = classifyToken2022PumpSwapMetadataMint({ account: sourceBaseMintAccount, expectedMint: baseMintAccount.address,
          expectedDecimals: sourceBaseMintAccount.data[44]!, nowUnix: 0n });
        conditions |= parsed.conditions; powersMask |= parsed.mask;
        return { decimals: parsed.decimals, supply: u64(sourceBaseMintAccount.data, 36), program: sourceBaseMintAccount.owner };
      })
    : decodeExtensionFreeMint(baseMintAccount, poolBaseMint);
  const poolQuote = decodeExtensionFreeMint(quoteMintAccount, poolQuoteMint);
  if (poolQuote.program !== MIMIR_BETA_SPL_TOKEN_PROGRAM_ID) fail("Pump mint policy is invalid", pool);
  if (poolBase.supply === 0n) {
    throw new MimirBetaPoolIneligibleError("PUMPSWAP_POOL_BASE_SUPPLY_ZERO", "PumpSwap pool-native base mint supply is zero; orientation unsupported", pool);
  }
  let adapterVersion: MimirBetaAdapterVersion = 0;
  let token2022Mint: Address | null = null;
  let token2022BaseReserve: bigint | null = null;
  if (extendedToken2022) {
    if (sourceBaseVault.data.length !== 165 && sourceBaseVault.data.length !== 170) betaError("ACCOUNT_MALFORMED", "PumpSwap Token-2022 vault allocation is invalid", pool);
    const vault = token2022Policy(() => classifyToken2022Vault({
      account: sourceBaseVault, expectedVault: key(data, 139), expectedMint: sourceBaseMintAccount.address, expectedAuthority: pool,
      mintPolicy: { pausable: false, transferHook: false },
    }));
    conditions |= vault.conditions;
    token2022BaseReserve = vault.amount;
    adapterVersion = 1;
    token2022Mint = sourceBaseMintAccount.address;
  }
  const creator = key(data, 11); const index = u16(data, 9);
  const canonicalCreator = derivePdaSync(PUMP_PROGRAM_ID, [utf8("pool-authority"), addressBytes(poolBaseMint)]);
  const canonical = index === 0 && creator === canonicalCreator;
  canonicalBool(data, 243, "Pump pool mayhem", pool);
  canonicalBool(data, 244, "Pump pool cashback", pool);
  const globalAccount = requiredAccount(roles, "global-config"); const globalAddress = derivePdaSync(program, [utf8("global_config")]);
  if (globalAccount.data.length !== 940 && globalAccount.data.length !== 949) fail("Pump global allocation is invalid", globalAddress);
  const global = requireEnvelope(globalAccount, globalAddress, program, globalAccount.data.length);
  requireDiscriminator(global, Uint8Array.of(149, 8, 156, 202, 160, 252, 176, 217), globalAddress);
  const globalFees = checkedPumpFees({ lp: u64(global, 40), protocol: u64(global, 48), creator: u64(global, 313) }, "Pump global", globalAddress);
  const disableFlags = global[56]!;
  if ((disableFlags & ~0x1f) !== 0 || (disableFlags & 0x18) !== 0 || u64(global, 899) > 10_000n) fail("Pump global lifecycle/fee policy is invalid", globalAddress);
  canonicalBool(global, 417, "Pump global mayhem", globalAddress);
  canonicalBool(global, 642, "Pump global cashback", globalAddress);
  canonicalBool(global, 939, "Pump global boost", globalAddress);
  const creatorFeeEnabled = global.length === 949 && canonicalBool(global, 940, "Pump global creator fee", globalAddress);
  if (global.length === 949 && u64(global, 941) > 10_000n) fail("Pump global creator fee maximum is invalid", globalAddress);
  if (globalFees.lp + globalFees.protocol + globalFees.creator > 10_000n) {
    fail("Pump pool/global mode provenance is invalid", pool);
  }
  const feeAccount = requiredAccount(roles, "fee-config");
  const [feeAddress, feeBump] = derivePdaSyncWithBump(PUMP_FEE_PROGRAM_ID, [utf8("fee_config"), addressBytes(program)]);
  const feeData = requireEnvelope(feeAccount, feeAddress, PUMP_FEE_PROGRAM_ID, feeAccount.data.length);
  const feeConfig = decodePumpFeeConfig(feeData, feeAddress, feeBump);
  const poolBaseReserve = token2022BaseReserve ?? decodeExtensionFreeVault(
    baseIsA ? sourceBaseVault : requiredAccount(roles, "quote-vault"),
    key(data, 139), poolBaseMint, pool, poolBase.program);
  const poolQuoteReserve = decodeExtensionFreeVault(baseIsA ? requiredAccount(roles, "quote-vault") : requiredAccount(roles, "base-vault"),
    key(data, 171), poolQuoteMint, pool, poolQuote.program);
  const isMayhemMode = canonicalBool(data, 243, "Pump pool mayhem", pool);
  canonicalBool(data, 244, "Pump pool cashback", pool);
  const poolCreatorFee = u64(data, 261);
  canonicalBool(data, 269, "Pump pool creator fee editable", pool);
  const effectiveQuote = poolQuoteReserve + i128(data, 245);
  if (poolBaseReserve === 0n || effectiveQuote <= 0n || effectiveQuote > U128_MAX) fail("Pump effective/real reserve is invalid", pool);
  const spendableQuote = poolQuoteReserve - u64(data, 271) - u64(data, 279);
  if (poolQuoteReserve === 0n ? spendableQuote < 0n : spendableQuote <= 0n) fail("Pump retained fees exhaust the real quote reserve", pool);
  if (poolQuoteReserve === 0n) conditions |= MIMIR_COND.DEPTH_BELOW_FLOOR;
  const marketCapNumerator = effectiveQuote * (isMayhemMode ? 1_000_000_000_000_000n : poolBase.supply);
  if (marketCapNumerator > U256_MAX) fail("Pump market-cap arithmetic overflow", pool);
  const marketCap = marketCapNumerator / poolBaseReserve;
  if (marketCap > U128_MAX) fail("Pump market cap is out of range", pool);
  const selectTier = (tiers: readonly Readonly<{ threshold: bigint; fees: PumpFees }>[]): PumpFees => {
    let selected = tiers[0]!.fees;
    for (const tier of tiers) if (tier.threshold <= marketCap) selected = tier.fees;
    return selected;
  };
  let selected = feeConfig.flat;
  if (canonical) {
    const quoteIsSol = isZeroBytes(addressBytes(poolQuoteMint)) || poolQuoteMint === SPL_NATIVE_MINT || poolQuoteMint === PUMP_NATIVE_MINT_2022;
    const quoteIsUsdc = poolQuoteMint === address(canonicalAddress("USDC"));
    if (quoteIsSol) selected = selectTier(feeConfig.regular);
    else if (quoteIsUsdc) selected = selectTier(feeConfig.stable.length > 0 ? feeConfig.stable : feeConfig.regular);
    else selected = feeConfig.exotic.lp === 0n && feeConfig.exotic.protocol === 0n && feeConfig.exotic.creator === 0n
      ? feeConfig.flat : feeConfig.exotic;
  }
  const coinCreator = key(data, 211);
  const selectedCreator = creatorFeeEnabled && poolCreatorFee > 0n ? poolCreatorFee : selected.creator;
  const effectiveFees = checkedPumpFees({ lp: selected.lp, protocol: selected.protocol,
    creator: isZeroBytes(addressBytes(coinCreator)) ? 0n : selectedCreator }, "Pump effective", pool);
  const aggregatePpm = (effectiveFees.lp + effectiveFees.protocol + effectiveFees.creator) * 100n;
  if (aggregatePpm > 1_000_000n) fail("Pump aggregate fee is out of range", pool);
  const baseReserve = baseIsA ? poolBaseReserve : spendableQuote;
  const quoteReserve = baseIsA ? spendableQuote : poolBaseReserve;
  return { authority: pool, tokenProgram: baseIsA ? poolBase.program : poolQuote.program,
    baseDecimals: baseIsA ? poolBase.decimals : poolQuote.decimals, quoteDecimals: baseIsA ? poolQuote.decimals : poolBase.decimals,
    baseReserve, quoteReserve, ...(poolQuoteReserve === 0n ? { depth: 0n, pointOnly: true } : pointDepth(baseReserve, quoteReserve, aggregatePpm)),
    adapterVersion, token2022Mint, effectiveQuote,
    quoteTokenProgram: poolQuote.program, conditions, powersMask };
}

export function deriveMimirBetaPumpSwapBoostVault(pool: Address, quoteMint: Address, quoteTokenProgram: Address): Address {
  return pumpSwapBoostVaultAndOwner(pool, quoteMint, quoteTokenProgram).vault;
}

function pumpSwapBoostVaultAndOwner(pool: Address, quoteMint: Address, quoteTokenProgram: Address): Readonly<{ vault: Address; owner: Address }> {
  const owner = derivePdaSync(PROGRAMS.pumpswap, [utf8("boost_vault"), addressBytes(pool)]);
  return { owner, vault: derivePdaSync(address(canonicalAddress("SPL_ASSOCIATED_TOKEN")),
    [addressBytes(owner), addressBytes(quoteTokenProgram), addressBytes(quoteMint)]) };
}

function pumpSwapBoostDisclosure(vault: MimirBetaCapturedAccount | null, pool: Address, quoteMint: Address, quoteTokenProgram: Address,
  effectiveQuote: bigint): Readonly<{ boostVaultLamports: bigint; maxBoostDriftBps: bigint }> {
  const expected = pumpSwapBoostVaultAndOwner(pool, quoteMint, quoteTokenProgram);
  let amount = 0n;
  if (vault !== null) {
    if (vault.address !== expected.vault) betaError("PDA_MISMATCH", "PumpSwap boost vault address mismatch", vault.address);
    const data = vault.data;
    if (vault.owner !== SYSTEM_PROGRAM_ID || data.length !== 0) {
      if (vault.owner !== quoteTokenProgram || vault.executable || data.length !== 165 || key(data, 0) !== quoteMint || key(data, 32) !== expected.owner) {
        fail("PumpSwap boost vault token account is invalid", expected.vault);
      }
      amount = u64(data, 64);
    }
  }
  return { boostVaultLamports: amount, maxBoostDriftBps: amount * (2n * effectiveQuote + amount) * 10_000n / (effectiveQuote * effectiveQuote) };
}

function baseNativeToQuoteNative(amount: bigint, normalizedPrice: bigint, baseDecimals: number, quoteDecimals: number): bigint {
  const pow10 = (decimals: number): bigint => 10n ** BigInt(decimals);
  return assertU128((amount * normalizedPrice * pow10(quoteDecimals)) / (Q64 * pow10(baseDecimals)));
}

async function decodeMeteoraDlmm(
  roles: ReadonlyMap<string, CapacityAccount>, pool: Address, data: Uint8Array, baseIsA: boolean,
  baseDecimals: number, quoteDecimals: number, routeableLegacy = false,
): Promise<{ authority: Address; depth: bigint; rawQuotePerBaseX64: bigint; conditions: number }> {
  const program = PROGRAMS["meteora-dlmm"]; const active = i32(data, 76); const step = u16(data, 80);
  if (step <= 0 || step > 400) fail("invalid DLMM bin step", pool);
  const target = Math.ceil(50 / step); const checkedLower = checkedTick(active - target); const checkedUpper = checkedTick(active + target);
  const activeArrayLower = floorDiv(active, 70) * 70;
  const lower = routeableLegacy ? checkedLower : Math.max(checkedLower, activeArrayLower);
  const upper = routeableLegacy ? checkedUpper : Math.min(checkedUpper, activeArrayLower + 69);
  const lowerIndex = routeableLegacy ? floorDiv(active, 70) - 1 : floorDiv(lower, 70);
  const upperIndex = routeableLegacy ? floorDiv(active, 70) + 1 : floorDiv(upper, 70);
  const arrays = new Map<number, Uint8Array>();
  for (let index = lowerIndex; index <= upperIndex; index += 1) {
    const account = requiredAccount(roles, "bin-array", index);
    await requirePda(program, [utf8("bin_array"), addressBytes(pool), i64Le(index)], account.address);
    const array = requireEnvelope(account, account.address, program, 10_136);
    requireDiscriminator(array, Uint8Array.of(92, 142, 92, 220, 5, 148, 70, 181), account.address, true);
    if (i64(array, 8) !== BigInt(index) || key(array, 24) !== pool) fail("invalid DLMM bin relation", account.address);
    if (routeableLegacy && (array[16]! < 1 || array[16]! > 3 || array.subarray(17, 24).some((byte) => byte !== 0))) {
      fail("invalid DLMM bin array header", account.address);
    }
    arrays.set(index, array);
  }
  const bin = (id: number): { x: bigint; y: bigint; price: bigint } => {
    const index = floorDiv(id, 70); const array = arrays.get(index); if (!array) fail("DLMM bin closure incomplete", pool);
    const local = id - index * 70; const offset = 56 + local * 144;
    return { x: u64(array, offset), y: u64(array, offset + 8), price: u128(array, offset + 16) };
  };
  const rawPrice = meteoraDlmmPriceFromIdX64(active, step); const activeBin = bin(active);
  const conditions = activeBin.x === 0n && activeBin.y === 0n ? MIMIR_COND.DEPTH_BELOW_FLOOR : 0;
  if (activeBin.price !== 0n && activeBin.price !== rawPrice) fail("DLMM active price mismatch", pool);
  let x = 0n; let y = 0n;
  for (let id = lower; id <= active; id += 1) y = assertU128(y + bin(id).y);
  for (let id = active; id <= upper; id += 1) x = assertU128(x + bin(id).x);
  const normalized = baseIsA
    ? normalizedDirectQ64PriceX64(rawPrice, baseDecimals, quoteDecimals)
    : normalizedInverseQ64PriceX64(rawPrice, baseDecimals, quoteDecimals);
  const yQuote = baseIsA ? y : routeableLegacy ? assertU128(y * rawQuotePerBaseX64(rawPrice, false) / Q64)
    : baseNativeToQuoteNative(y, normalized, baseDecimals, quoteDecimals);
  const xQuote = !baseIsA ? x : routeableLegacy ? assertU128(x * rawPrice / Q64)
    : baseNativeToQuoteNative(x, normalized, baseDecimals, quoteDecimals);
  const depth = min(xQuote, yQuote); if (depth <= 0n && conditions === 0) fail("zero DLMM depth", pool);
  return { authority: pool, depth, rawQuotePerBaseX64: rawQuotePerBaseX64(rawPrice, baseIsA), conditions };
}

/** @internal Current pair/closure already authenticated by freshDynamicAccounts. */
export async function mimirBetaDlmmRouteableLegacyDepth(args: Readonly<{
  pool: Address;
  pair: MimirBetaCapturedAccount;
  baseMint: Address;
  quoteMint: Address;
  binArrays: readonly [MimirBetaCapturedAccount, MimirBetaCapturedAccount, MimirBetaCapturedAccount];
}>): Promise<bigint> {
  const pair: CapacityAccount = { ...args.pair, role: "pool" };
  const data = requireEnvelope(pair, args.pool, PROGRAMS["meteora-dlmm"], 904);
  requireDiscriminator(data, Uint8Array.of(33, 11, 49, 98, 181, 101, 177, 13), args.pool);
  const baseIsA = key(data, 88) === args.baseMint && key(data, 120) === args.quoteMint;
  if (!baseIsA && !(key(data, 88) === args.quoteMint && key(data, 120) === args.baseMint)) fail("DLMM pair orientation mismatch", args.pool);
  if (args.binArrays.length !== 3 || new Set([args.pool, ...args.binArrays.map((row) => row.address)]).size !== 4) {
    fail("DLMM routeable array closure is not unique", args.pool);
  }
  const activeIndex = floorDiv(i32(data, 76), 70);
  const roles = new Map(args.binArrays.map((row, offset) => {
    const index = activeIndex + offset - 1;
    return [roleKey("bin-array", index), { ...row, role: "bin-array" as const, index }] as const;
  }));
  return (await decodeMeteoraDlmm(roles, args.pool, data, baseIsA, 0, 0, true)).depth;
}

function cpAmmDepth(data: Uint8Array, baseIsA: boolean): bigint {
  const liquidityX64 = u128(data, 360); const sqrtMin = u128(data, 424); const sqrtMax = u128(data, 440); const sqrt = u128(data, 456);
  if (sqrtMin <= 0n || sqrtMax <= sqrtMin || sqrt < sqrtMin || sqrt > sqrtMax) fail("invalid DAMM-v2 curve state");
  const lower = (sqrt * SQRT_DOWN_50_BPS_X64) / Q64 < sqrtMin ? sqrtMin : (sqrt * SQRT_DOWN_50_BPS_X64) / Q64;
  const targetUp = ceilDiv(sqrt * SQRT_UP_50_BPS_X64, Q64); const upper = targetUp > sqrtMax ? sqrtMax : targetUp;
  const amountA = ceilDiv(liquidityX64 * (sqrt - lower), lower * sqrt);
  const amountB = ceilDiv(liquidityX64 * (upper - sqrt), Q64 * Q64);
  const rawPrice = squareQ64ToX64(sqrt);
  const upQuote = baseIsA ? amountB : amountA; const downQuote = baseIsA ? (amountA * rawPrice) / Q64 : (amountB * Q64) / rawPrice;
  return assertU128(min(upQuote, downQuote));
}

async function capacityEvidence(plan: MimirBetaCaptureReadPlan, accounts: ReadonlyMap<Address, MimirBetaCapturedAccount>): Promise<readonly MimirBetaCaptureEvidenceAccount[]> {
  const planned = [{ role: "pool" as const, index: null, address: plan.pool },
    ...plan.auxiliary.map((node) => ({ role: node.role, index: node.index, address: node.address }))];
  const rows: MimirBetaCaptureEvidenceAccount[] = await Promise.all(planned.map(async (node) => {
    const account = accounts.get(node.address); if (!account) betaError("CAPTURE_PLAN_MISMATCH", "evidence account missing", node.address);
    return { role: node.role, index: node.index, address: account.address, owner: account.owner,
      ...(plan.family === "raydium-amm-v4" || plan.family === "pumpswap" ? { executable: account.executable } : {}),
      dataHash: hex(await sha256(account.data)) };
  }));
  return rows.sort((left, right) => compareAscii(left.role, right.role) ||
    compareAscii(left.index ?? "", right.index ?? "") || compareAddressBytes(left.address, right.address));
}

export async function decodeMimirBetaCaptureCandidate(input: MimirBetaCaptureCandidateInput): Promise<MimirBetaCaptureCandidate> {
  const descriptor = descriptorForInput(input.descriptor);
  const expectedPlanSnapshot = canonicalJson(input.expectedPlan as never);
  if (input.accounts.length < 5 || input.accounts.length > MAX_CAPTURE_ACCOUNTS_PER_POOL) betaError("CAPTURE_PLAN_MISMATCH", "captured account count is out of bounds");
  const rows = new Map<Address, MimirBetaCapturedAccount>();
  for (const original of input.accounts) {
    if (!original || !(original.data instanceof Uint8Array) || typeof original.executable !== "boolean") {
      betaError("ACCOUNT_MALFORMED", "captured account row is malformed");
    }
    const row = { address: checkedAddress(original.address, "captured account"), owner: checkedAddress(original.owner, "captured owner"),
      executable: original.executable, data: original.data.slice() };
    if (rows.has(row.address)) betaError("CAPTURE_PLAN_MISMATCH", "duplicate captured account", row.address);
    rows.set(row.address, row);
  }
  const expectedAddresses = new Set(input.expectedPlan.allAddresses);
  if (rows.size !== expectedAddresses.size || [...rows.keys()].some((value) => !expectedAddresses.has(value)) ||
      [...expectedAddresses].some((value) => !rows.has(value))) betaError("CAPTURE_PLAN_MISMATCH", "captured address set differs from frozen plan");
  const primary = rows.get(input.expectedPlan.pool);
  if (!primary) betaError("CAPTURE_PLAN_MISMATCH", "captured primary is missing", input.expectedPlan.pool);
  const actualPlan = deriveMimirBetaCaptureReadPlan({ descriptor, primary, pair: input.pair, context: input.context, existingFeed: input.existingFeed === true });
  if (actualPlan.planHash !== input.expectedPlan.planHash || actualPlan.descriptorId !== input.expectedPlan.descriptorId ||
      actualPlan.descriptorHash !== input.expectedPlan.descriptorHash ||
      actualPlan.baseMint !== input.expectedPlan.baseMint || actualPlan.quoteMint !== input.expectedPlan.quoteMint ||
      canonicalJson({ ...actualPlan, primaryDataSha256: input.expectedPlan.primaryDataSha256 } as never) !== expectedPlanSnapshot) {
    betaError("CAPTURE_PLAN_MISMATCH", "captured primary recomputes a different frozen plan", input.expectedPlan.pool);
  }
  const roles = new Map<string, CapacityAccount>();
  const addRole = (role: CapacityAccountRole, addressValue: Address, index?: number): void => {
    const row = rows.get(addressValue); if (!row) betaError("CAPTURE_PLAN_MISMATCH", "planned captured row is missing", addressValue);
    const identity = roleKey(role, index); if (roles.has(identity)) betaError("CAPTURE_PLAN_MISMATCH", "duplicate planned role", addressValue);
    roles.set(identity, { ...row, role, ...(index === undefined ? {} : { index }) });
  };
  addRole("pool", actualPlan.pool);
  for (const node of actualPlan.auxiliary) {
    if (node.role === "base-mint" || node.role === "quote-mint" || node.role === "base-vault" || node.role === "quote-vault") addRole(node.role, node.address);
    else if (node.role === "whirlpools-config" || node.role === "amm-config") addRole("family-config", node.address);
    else if (node.role === "cpmm-observation") addRole("observation-state", node.address);
    else if (node.role === "clmm-observation") addRole("clmm-observation", node.address);
    else if (node.role === "open-orders" || node.role === "market" || node.role === "market-program" ||
      node.role === "global-config" || node.role === "fee-config") addRole(node.role, node.address);
    else if (node.role.startsWith("tick-array-")) addRole("tick-array", node.address, Number(node.index));
    else if (node.role === "depth-bin-array") addRole("bin-array", node.address, Number(node.index));
    else if (node.role === "orca-oracle") addRole("orca-oracle", node.address);
    else betaError("CAPTURE_PLAN_MISMATCH", "unknown capture plan role", node.address);
  }
  const pool = actualPlan.pool; const programId = actualPlan.program;
  const poolAccount = requiredAccount(roles, "pool"); const data = requireEnvelope(poolAccount, pool, programId, descriptor.allocationSize);
  const mintA = key(data, descriptor.mintAOffset); const baseMint = actualPlan.baseMint; const quoteMint = actualPlan.quoteMint;
  const canonicalMint0 = actualPlan.canonicalMint0; const canonicalMint1 = actualPlan.canonicalMint1;
  const baseIsA = mintA === baseMint; const baseVault = actualPlan.baseVault; const quoteVault = actualPlan.quoteVault;
  const token2022Policy = <T>(run: () => T): T => {
    try { return run(); }
    catch (error) {
      if (isToken2022ClmmAccountError(error)) betaError("ACCOUNT_MALFORMED", error.message, pool);
      if (isToken2022ClmmPolicyError(error)) betaError(error.code, error.message, pool);
      throw error;
    }
  };

  let baseDecimals: number; let quoteDecimals: number;
  if (descriptor.family === "pumpswap") { baseDecimals = 0; quoteDecimals = 0; }
  else if (descriptor.family === "raydium-clmm") {
    const expectedBaseDecimals = data[baseIsA ? 233 : 234]!;
    const expectedQuoteDecimals = data[baseIsA ? 234 : 233]!;
    const baseMintAccount = requiredAccount(roles, "base-mint");
    const quoteMintAccount = requiredAccount(roles, "quote-mint");
    baseDecimals = baseMintAccount.owner === MIMIR_BETA_SPL_TOKEN_PROGRAM_ID ? decodeMint(baseMintAccount, baseMint) : expectedBaseDecimals;
    quoteDecimals = quoteMintAccount.owner === MIMIR_BETA_SPL_TOKEN_PROGRAM_ID ? decodeMint(quoteMintAccount, quoteMint) : expectedQuoteDecimals;
  } else if (descriptor.family === "meteora-dlmm") {
    const baseMintAccount = requiredAccount(roles, "base-mint");
    const quoteMintAccount = requiredAccount(roles, "quote-mint");
    baseDecimals = baseMintAccount.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID
      ? token2022Policy(() => classifyToken2022Mint({ account: baseMintAccount, expectedMint: baseMint,
        expectedDecimals: baseMintAccount.data[44]!, nowUnix: input.context.observedUnixTimestamp })).decimals
      : decodeMint(baseMintAccount, baseMint);
    quoteDecimals = quoteMintAccount.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID
      ? token2022Policy(() => classifyToken2022Mint({ account: quoteMintAccount, expectedMint: quoteMint,
        expectedDecimals: quoteMintAccount.data[44]!, nowUnix: input.context.observedUnixTimestamp })).decimals
      : decodeMint(quoteMintAccount, quoteMint);
  } else {
    for (const [role, expected] of [["base-mint", baseMint], ["quote-mint", quoteMint]] as const) {
      const account = requiredAccount(roles, role);
      if (account.address === expected && !account.executable && account.owner === MIMIR_BETA_TOKEN_2022_PROGRAM_ID) {
        throw new MimirBetaPoolIneligibleError({ kind: "TOKEN_2022_FAMILY_UNSUPPORTED", family: descriptor.family }, `${descriptor.family} does not support Token-2022 mints`, pool,
          "TOKEN_PROGRAM_PAIR_UNSUPPORTED");
      }
    }
    baseDecimals = decodeMint(requiredAccount(roles, "base-mint"), baseMint);
    quoteDecimals = decodeMint(requiredAccount(roles, "quote-mint"), quoteMint);
  }
  let authority: Address; let familyConfig: Address | null = null; let observationState: Address | null = null;
  let depth: bigint; let baseFees = 0n; let quoteFees = 0n; let tokenProgramId: Address = MIMIR_BETA_SPL_TOKEN_PROGRAM_ID;
  let adapterVersion: MimirBetaAdapterVersion = 0;
  let token2022Mint: Address | null = null;
  let token2022PolicyHash: string | null = null;
  let reserveOverride: readonly [bigint, bigint] | null = null; let pointOnly = false;
  let boost: Readonly<{ boostVaultLamports: bigint; maxBoostDriftBps: bigint; pumpSwapBaseIsA: boolean }> | null = null;
  let rangeRawQuotePerBaseX64: bigint | null = null;
  let conditions = 0; let powersMask = 0;
  switch (descriptor.family) {
    case "orca-whirlpool": {
      const decoded = await decodeOrca(descriptor.programId, roles, pool, data, baseIsA, input.context.observedUnixTimestamp); authority = decoded.authority; familyConfig = decoded.config;
      depth = decoded.depth; rangeRawQuotePerBaseX64 = decoded.rawQuotePerBaseX64 ?? 0n;
      if (decoded.rawQuotePerBaseX64 === null) conditions |= MIMIR_COND.SCALE_UNREPRESENTABLE;
      break;
    }
    case "raydium-clmm": {
      if (data[baseIsA ? 233 : 234] !== baseDecimals || data[baseIsA ? 234 : 233] !== quoteDecimals) fail("CLMM mint decimals mismatch", pool);
      const decoded = await decodeRaydiumClmm(descriptor.programId, roles, pool, data, baseIsA, input.context.observedUnixTimestamp); authority = decoded.authority; familyConfig = decoded.config;
      depth = decoded.depth; rangeRawQuotePerBaseX64 = decoded.rawQuotePerBaseX64 ?? 0n;
      if (decoded.rawQuotePerBaseX64 === null) conditions |= MIMIR_COND.SCALE_UNREPRESENTABLE;
      const baseMintAccount = requiredAccount(roles, "base-mint");
      const quoteMintAccount = requiredAccount(roles, "quote-mint");
      const classicPair = baseMintAccount.owner === MIMIR_BETA_SPL_TOKEN_PROGRAM_ID && quoteMintAccount.owner === MIMIR_BETA_SPL_TOKEN_PROGRAM_ID;
      if (!classicPair) {
        const classification: Token2022ClmmPairClassification = token2022Policy(() => classifyToken2022ClmmPair({
          baseMint,
          quoteMint,
          baseMintAccount,
          quoteMintAccount,
          baseVaultAccount: requiredAccount(roles, "base-vault"),
          quoteVaultAccount: requiredAccount(roles, "quote-vault"),
          authority,
          baseDecimals,
          quoteDecimals,
          nowUnix: input.context.observedUnixTimestamp,
        }));
        conditions |= classification.conditions; powersMask |= classification.mask;
        adapterVersion = classification.adapterVersion;
        token2022Mint = classification.token2022Mint;
        tokenProgramId = classification.tokenProgramId;
        baseDecimals = classification.baseDecimals;
        quoteDecimals = classification.quoteDecimals;
        reserveOverride = [classification.baseAmount, classification.quoteAmount];
        if (classification.token2022Mint !== null) {
          const selectedMintAccount = classification.token2022Mint === baseMint ? baseMintAccount : quoteMintAccount;
          const selectedVaultAccount = classification.token2022Mint === baseMint
            ? requiredAccount(roles, "base-vault")
            : requiredAccount(roles, "quote-vault");
          token2022PolicyHash = await computeToken2022ClmmPolicyHash({ mint: selectedMintAccount, vault: selectedVaultAccount });
        }
      }
      break;
    }
    case "raydium-cpmm": {
      if (data[baseIsA ? 331 : 332] !== baseDecimals || data[baseIsA ? 332 : 331] !== quoteDecimals) fail("CPMM mint decimals mismatch", pool);
      const decoded = await decodeRaydiumCpmm(descriptor.programId, roles, pool, data, baseIsA); authority = decoded.authority; familyConfig = decoded.config;
      observationState = decoded.observation; baseFees = decoded.baseFees; quoteFees = decoded.quoteFees; depth = 0n; break;
    }
    case "raydium-amm-v4": {
      const decoded = decodeRaydiumAmmV4(descriptor.programId, roles, pool, data, baseIsA, baseDecimals, quoteDecimals);
      authority = decoded.authority; depth = decoded.depth; reserveOverride = [decoded.baseReserve, decoded.quoteReserve];
      pointOnly = decoded.pointOnly; break;
    }
    case "pumpswap": {
      const decoded = decodePumpSwap(roles, pool, data, baseIsA); authority = decoded.authority; tokenProgramId = decoded.tokenProgram;
      baseDecimals = decoded.baseDecimals; quoteDecimals = decoded.quoteDecimals; depth = decoded.depth;
      adapterVersion = decoded.adapterVersion; token2022Mint = decoded.token2022Mint;
      reserveOverride = [decoded.baseReserve, decoded.quoteReserve]; pointOnly = decoded.pointOnly;
      conditions |= decoded.conditions; powersMask |= decoded.powersMask;
      if (input.pumpSwapBoostVault !== undefined) boost = { ...pumpSwapBoostDisclosure(input.pumpSwapBoostVault, pool, key(data, 75), decoded.quoteTokenProgram, decoded.effectiveQuote), pumpSwapBaseIsA: baseIsA };
      break;
    }
    case "meteora-dlmm": {
      const baseMintAccount = requiredAccount(roles, "base-mint");
      const quoteMintAccount = requiredAccount(roles, "quote-mint");
      const classification = token2022Policy(() => classifyToken2022ClmmPair({
        baseMint, quoteMint, baseMintAccount, quoteMintAccount,
        baseVaultAccount: requiredAccount(roles, "base-vault"),
        quoteVaultAccount: requiredAccount(roles, "quote-vault"),
        authority: pool, baseDecimals, quoteDecimals, nowUnix: input.context.observedUnixTimestamp,
      }));
      conditions |= classification.conditions; powersMask |= classification.mask;
      adapterVersion = classification.adapterVersion;
      token2022Mint = classification.token2022Mint;
      tokenProgramId = classification.tokenProgramId;
      baseDecimals = classification.baseDecimals;
      quoteDecimals = classification.quoteDecimals;
      reserveOverride = [classification.baseAmount, classification.quoteAmount];
      if (classification.token2022Mint !== null) {
        const selectedMintAccount = classification.token2022Mint === baseMint ? baseMintAccount : quoteMintAccount;
        const selectedVaultAccount = classification.token2022Mint === baseMint
          ? requiredAccount(roles, "base-vault")
          : requiredAccount(roles, "quote-vault");
        if (selectedMintAccount.data.length <= 82) betaError("TOKEN_2022_POLICY_UNSUPPORTED", "DLMM V1 requires an extended mint", pool);
        token2022PolicyHash = await computeToken2022ClmmPolicyHash({ mint: selectedMintAccount, vault: selectedVaultAccount });
      }
      const decoded = await decodeMeteoraDlmm(roles, pool, data, baseIsA, baseDecimals, quoteDecimals); authority = decoded.authority;
      depth = decoded.depth; rangeRawQuotePerBaseX64 = decoded.rawQuotePerBaseX64; conditions |= decoded.conditions; break;
    }
    case "meteora-damm-v2": {
      const [derived] = await getProgramDerivedAddressCached(programId, [utf8("pool_authority")]);
      if (derived !== DAMM_V2_AUTHORITY) fail("DAMM-v2 authority constant mismatch", pool);
      authority = derived; depth = cpAmmDepth(data, baseIsA); break;
    }
  }
  let baseReserve: bigint; let quoteReserve: bigint;
  if (reserveOverride) [baseReserve, quoteReserve] = reserveOverride;
  else {
    const grossBase = decodeVault(requiredAccount(roles, "base-vault"), baseVault, baseMint, authority);
    const grossQuote = decodeVault(requiredAccount(roles, "quote-vault"), quoteVault, quoteMint, authority);
    if (grossBase <= baseFees || grossQuote <= quoteFees) fail("fees exhaust CPMM reserves", pool);
    baseReserve = grossBase - baseFees; quoteReserve = grossQuote - quoteFees;
  }
  if (descriptor.family === "raydium-cpmm") depth = cpmmZeroFeeImmediateUnwindBounds(baseReserve, quoteReserve, 50).capitalRequiredFloor;
  const minLiquidityNative = rangeRawQuotePerBaseX64 === null
    ? descriptor.family === "meteora-damm-v2" ? min(depth, min(baseReserve, quoteReserve)) : min(baseReserve, quoteReserve)
    : min(depth, min(quoteReserve, assertU128((baseReserve * rangeRawQuotePerBaseX64) / Q64)));
  for (const role of ["base-vault", "quote-vault"] as const) if (requiredAccount(roles, role).data[108] === 2) conditions |= MIMIR_COND.VAULT_FROZEN;
  if ((descriptor.family === "raydium-cpmm" || descriptor.family === "orca-whirlpool" || descriptor.family === "raydium-clmm" ||
    descriptor.family === "meteora-damm-v2") && (depth <= 0n || minLiquidityNative <= 0n)) {
    conditions |= MIMIR_COND.DEPTH_BELOW_FLOOR;
  }
  if (conditions === 0 && (minLiquidityNative <= 0n || depth <= 0n)) fail("zero capacity metric", pool);
  if (roles.size !== actualPlan.allAddresses.length) {
    fail("unexpected capacity closure role", pool);
  }
  const evidence = await capacityEvidence(actualPlan, rows);
  const capacityHash = await domainHash("MIMIR_BETA_CAPACITY_V1\0", canonicalJson({
    descriptorId: descriptor.descriptorId, descriptorHash: descriptor.descriptorHash, readPlanHash: actualPlan.planHash,
    family: descriptor.family, programId, pool, canonicalMint0, canonicalMint1, canonicalPairKey: actualPlan.canonicalPairKey,
    baseMint, quoteMint, direction: actualPlan.direction, baseVault, quoteVault,
    adapterVersion, token2022Mint, token2022PolicyHash,
    minLiquidityNative, minDepthTo50BpsNative: depth, accounts: evidence, ...(pointOnly ? { pointOnly: true } : {}),
  } as never));
  return Object.freeze({
    descriptorId: descriptor.descriptorId, descriptorHash: descriptor.descriptorHash, readPlanHash: actualPlan.planHash,
    family: descriptor.family, programId, pool, canonicalMint0, canonicalMint1, canonicalPairKey: actualPlan.canonicalPairKey,
    baseMint, quoteMint, direction: actualPlan.direction, baseVault, quoteVault,
    adapterVersion, token2022Mint, token2022PolicyHash,
    tokenProgramId, vaultAuthority: authority, familyConfig, observationState,
    minLiquidityNative, minDepthTo50BpsNative: depth,
    capacityEvidence: Object.freeze(evidence.map((row) => Object.freeze({ ...row }))), capacityHash,
    ...(pointOnly ? { pointOnly: true as const } : {}), ...(boost ?? {}),
    ...(conditions === 0 ? {} : { conditions, powersMask }),
  });
}

export function compareMimirBetaCaptureCandidates(left: MimirBetaCaptureCandidate, right: MimirBetaCaptureCandidate): number {
  if (left.minDepthTo50BpsNative !== right.minDepthTo50BpsNative) return left.minDepthTo50BpsNative > right.minDepthTo50BpsNative ? -1 : 1;
  if (left.minLiquidityNative !== right.minLiquidityNative) return left.minLiquidityNative > right.minLiquidityNative ? -1 : 1;
  return compareAscii(left.family, right.family) || compareAddressBytes(left.programId, right.programId) || compareAddressBytes(left.pool, right.pool);
}

export function assertUnambiguousMimirBetaCaptureCandidates(candidates: readonly MimirBetaCaptureCandidate[]): void {
  const pools = new Set<Address>(); const vaults = new Set<Address>();
  const orientations = new Map<string, string>();
  for (const candidate of [...candidates].sort((left, right) => compareAscii(left.family, right.family) ||
    compareAddressBytes(left.programId, right.programId) || compareAddressBytes(left.pool, right.pool))) {
    const orientation = `${candidate.baseMint}:${candidate.quoteMint}:${candidate.direction}`;
    const priorOrientation = orientations.get(candidate.canonicalPairKey);
    if (priorOrientation !== undefined && priorOrientation !== orientation) {
      betaError("PAIR_ORIENTATION_CONFLICT", "opposite economic orientations cannot share a capture cohort", candidate.pool);
    }
    orientations.set(candidate.canonicalPairKey, orientation);
    if (pools.has(candidate.pool) || vaults.has(candidate.baseVault) || vaults.has(candidate.quoteVault) || candidate.baseVault === candidate.quoteVault) {
      betaError("DUPLICATE_POOL", "ambiguous pool or vault identity", candidate.pool);
    }
    pools.add(candidate.pool); vaults.add(candidate.baseVault); vaults.add(candidate.quoteVault);
  }
}

export function selectMimirBetaCaptureCohort(candidates: readonly MimirBetaCaptureCandidate[]): MimirBetaCaptureCohort {
  assertUnambiguousMimirBetaCaptureCandidates(candidates);
  const ranked = [...candidates].sort(compareMimirBetaCaptureCandidates);
  const groups = new Map<string, MimirBetaCaptureCandidate[]>();
  for (const candidate of ranked) {
    const pair = `${candidate.canonicalMint0}:${candidate.canonicalMint1}`;
    const group = groups.get(pair) ?? []; group.push(candidate); groups.set(pair, group);
  }
  const entries = [...groups.values()];
  const primaryIndex = entries.findIndex((group) => group.length >= 5);
  if (primaryIndex < 0) betaError("NO_ELIGIBLE_POOLS", "capture cohort has no pair with five distinct pools");
  const primary = entries[primaryIndex]!.slice(0, 5); const pairs: MimirBetaCaptureCohortPair[] = [{
    mint0: primary[0]!.canonicalMint0, mint1: primary[0]!.canonicalMint1, pools: primary,
  }];
  for (let index = 0; index < entries.length && pairs.length < 5; index += 1) {
    if (index === primaryIndex) continue; const candidate = entries[index]![0]!;
    pairs.push({ mint0: candidate.canonicalMint0, mint1: candidate.canonicalMint1, pools: [candidate] });
  }
  if (pairs.length !== 5) betaError("NO_ELIGIBLE_POOLS", "capture cohort requires five unique pairs");
  const poolsOut = pairs.flatMap((pair) => pair.pools);
  if (poolsOut.length > 9) betaError("POOL_COUNT_OUT_OF_RANGE", "capture cohort exceeds nine pools");
  return Object.freeze({ pairs: Object.freeze(pairs.map((pair) => Object.freeze({ ...pair, pools: Object.freeze([...pair.pools]) }))), pools: Object.freeze(poolsOut) });
}

export async function revalidateMimirBetaCaptureCandidate(args: Readonly<{
  expected: MimirBetaCaptureCandidate;
  input: MimirBetaCaptureCandidateInput;
}>): Promise<MimirBetaCaptureCandidate> {
  const expected = cloneCallerOwned(args.expected);
  const expectedCanonical = canonicalJson(expected as never);
  const expectedPool = expected.pool;
  const actual = await decodeMimirBetaCaptureCandidate(args.input);
  if (canonicalJson(actual as never) !== expectedCanonical) {
    betaError("POOL_STALE", "capacity closure changed", expectedPool);
  }
  return actual;
}

function cloneCallerOwned<T>(value: T): T {
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map((entry) => cloneCallerOwned(entry)) as T;
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [keyName, entry] of Object.entries(value)) output[keyName] = cloneCallerOwned(entry);
    return output as T;
  }
  return value;
}

function freshDeepFrozen<T>(value: T): T {
  const copy = cloneCallerOwned(value);
  const freeze = (entry: unknown): void => {
    if (entry === null || typeof entry !== "object" || entry instanceof Uint8Array || Object.isFrozen(entry)) return;
    for (const child of Object.values(entry)) freeze(child);
    Object.freeze(entry);
  };
  freeze(copy);
  return copy;
}

function requireCanonicalEqual(actual: unknown, expected: unknown, message: string): void {
  if (canonicalJson(actual as never) !== canonicalJson(expected as never)) betaError("CAPTURE_PLAN_MISMATCH", message);
}

function sortedUniqueAddresses(values: readonly Address[], label: string): readonly Address[] {
  const checked = values.map((value) => checkedAddress(value, label));
  const sorted = [...checked].sort(compareAddressBytes);
  if (new Set(sorted).size !== sorted.length) betaError("CAPTURE_PLAN_MISMATCH", `${label} contains a duplicate`);
  return Object.freeze(sorted);
}

function requireExactSortedAddresses(values: readonly Address[], expected: readonly Address[], label: string): void {
  const checked = sortedUniqueAddresses(values, label);
  if (canonicalJson(checked as never) !== canonicalJson(expected as never) ||
      canonicalJson(values as never) !== canonicalJson(checked as never)) {
    betaError("CAPTURE_PLAN_MISMATCH", `${label} differs from the exact sorted address set`);
  }
}

export async function revalidateMimirBetaCapture(
  input: Readonly<MimirBetaCaptureRevalidationInput>,
): Promise<MimirBetaCaptureRevalidationResult> {
  if (!input || !input.preGma || !input.trust || !Array.isArray(input.accounts)) {
    betaError("INVALID_ARGUMENT", "capture revalidation input is malformed");
  }

  // This entire ownership boundary is intentionally synchronous: nothing below may observe caller mutation.
  const preGma = cloneCallerOwned(input.preGma);
  const trust = cloneCallerOwned(input.trust);
  const deployment = validateMimirBetaDeployment(trust.deployment);
  const originalRows = input.accounts as readonly (MimirBetaAccount | null | undefined)[];
  if (originalRows.length < 1 || originalRows.length > MAX_GLOBAL_CAPTURE_ACCOUNTS) {
    betaError("CAPTURE_PLAN_MISMATCH", "global captured account count is out of bounds");
  }
  const rows = new Map<Address, MimirBetaAccount>();
  for (const original of originalRows) {
    if (!original || !(original.data instanceof Uint8Array) || typeof original.executable !== "boolean" ||
        typeof original.lamports !== "bigint" || original.lamports < 0n) {
      betaError("ACCOUNT_MALFORMED", "global captured account row is malformed");
    }
    const row: MimirBetaAccount = {
      address: checkedAddress(original.address, "global captured account"),
      owner: checkedAddress(original.owner, "global captured owner"),
      executable: original.executable,
      lamports: original.lamports,
      data: original.data.slice(),
    };
    if (rows.has(row.address)) betaError("CAPTURE_PLAN_MISMATCH", "duplicate global captured account", row.address);
    rows.set(row.address, row);
  }
  if (!preGma || !Array.isArray(preGma.selectedPools) || !Array.isArray(preGma.planAddresses) ||
      !Array.isArray(preGma.roleGraph) || !Array.isArray(preGma.programs) || !preGma.cohort) {
    betaError("INVALID_ARGUMENT", "pre-GMA capture expectation is malformed");
  }

  const expectedCandidates = new Map<Address, MimirBetaCaptureCandidate>();
  for (const candidate of preGma.cohort.pools) {
    const pool = checkedAddress(candidate.pool, "expected cohort pool");
    if (expectedCandidates.has(pool)) betaError("CAPTURE_PLAN_MISMATCH", "duplicate expected cohort pool", pool);
    expectedCandidates.set(pool, candidate);
  }
  const expectedReselection = selectMimirBetaCaptureCohort([...preGma.cohort.pools]);
  requireCanonicalEqual(expectedReselection, preGma.cohort, "expected cohort is not self-consistent");
  if (preGma.selectedPools.length !== expectedCandidates.size) {
    betaError("CAPTURE_PLAN_MISMATCH", "selected-pool plan set size differs from cohort");
  }

  const selected = new Map<Address, MimirBetaCaptureSelectedPoolPlan>();
  for (const selectedPlan of preGma.selectedPools) {
    if (!selectedPlan || !selectedPlan.expectedPlan || !selectedPlan.pair || !selectedPlan.context) {
      betaError("CAPTURE_PLAN_MISMATCH", "selected-pool plan is malformed");
    }
    const descriptor = descriptorForInput(selectedPlan.descriptor);
    const plan = selectedPlan.expectedPlan;
    const pool = checkedAddress(plan.pool, "selected plan pool");
    const expected = expectedCandidates.get(pool);
    if (!expected || selected.has(pool)) betaError("CAPTURE_PLAN_MISMATCH", "selected-pool plan is missing, duplicate, or unknown", pool);
    selected.set(pool, selectedPlan);
    if (plan.descriptorId !== descriptor.descriptorId || plan.descriptorHash !== descriptor.descriptorHash ||
        plan.family !== descriptor.family || plan.program !== descriptor.programId || expected.descriptorId !== descriptor.descriptorId ||
        expected.descriptorHash !== descriptor.descriptorHash || expected.family !== descriptor.family || expected.programId !== descriptor.programId ||
        plan.baseMint !== selectedPlan.pair.baseMint || plan.quoteMint !== selectedPlan.pair.quoteMint ||
        expected.baseMint !== selectedPlan.pair.baseMint || expected.quoteMint !== selectedPlan.pair.quoteMint ||
        canonicalJson(plan.context as never) !== canonicalJson(selectedPlan.context as never) ||
        expected.readPlanHash !== plan.planHash || expected.pool !== plan.pool || expected.baseVault !== plan.baseVault ||
        expected.quoteVault !== plan.quoteVault || expected.canonicalMint0 !== plan.canonicalMint0 ||
        expected.canonicalMint1 !== plan.canonicalMint1 || expected.canonicalPairKey !== plan.canonicalPairKey) {
      betaError("CAPTURE_PLAN_MISMATCH", "selected descriptor, orientation, context, plan, and candidate binding differs", pool);
    }
  }

  const planUnion = Object.freeze([...new Set(
    [...selected.values()].flatMap((entry) => entry.expectedPlan.allAddresses.map((value) => checkedAddress(value, "selected plan union"))),
  )].sort(compareAddressBytes));
  requireExactSortedAddresses(preGma.planAddresses, planUnion, "pre-GMA plan addresses");

  const actualCandidates: MimirBetaCaptureCandidate[] = [];
  for (const expected of preGma.cohort.pools) {
    const selectedPlan = selected.get(expected.pool);
    if (!selectedPlan) betaError("CAPTURE_PLAN_MISMATCH", "cohort pool has no selected plan", expected.pool);
    const planRows = selectedPlan.expectedPlan.allAddresses.map((accountAddress) => {
      const row = rows.get(accountAddress);
      if (!row) betaError("CAPTURE_PLAN_MISMATCH", "selected plan row is missing", accountAddress);
      return { address: row.address, owner: row.owner, executable: row.executable, data: row.data };
    });
    const actual = await decodeMimirBetaCaptureCandidate({
      descriptor: selectedPlan.descriptor,
      pair: selectedPlan.pair,
      context: selectedPlan.context,
      expectedPlan: selectedPlan.expectedPlan,
      accounts: planRows,
    });
    const immutable = (candidate: MimirBetaCaptureCandidate) => ({
      descriptorId: candidate.descriptorId, descriptorHash: candidate.descriptorHash, readPlanHash: candidate.readPlanHash,
      family: candidate.family, programId: candidate.programId, pool: candidate.pool,
      canonicalMint0: candidate.canonicalMint0, canonicalMint1: candidate.canonicalMint1,
      canonicalPairKey: candidate.canonicalPairKey, direction: candidate.direction,
      baseMint: candidate.baseMint, quoteMint: candidate.quoteMint, baseVault: candidate.baseVault, quoteVault: candidate.quoteVault,
      adapterVersion: candidate.adapterVersion, token2022Mint: candidate.token2022Mint,
      token2022PolicyHash: candidate.token2022PolicyHash,
      tokenProgramId: candidate.tokenProgramId, vaultAuthority: candidate.vaultAuthority,
      familyConfig: candidate.familyConfig, observationState: candidate.observationState,
    });
    requireCanonicalEqual(immutable(actual), immutable(expected), "final candidate identity or topology changed");
    actualCandidates.push(actual);
  }
  const actualByPool = new Map(actualCandidates.map((candidate) => [candidate.pool, candidate]));
  const actualCohort: MimirBetaCaptureCohort = {
    pairs: preGma.cohort.pairs.map((pair) => ({
      mint0: pair.mint0,
      mint1: pair.mint1,
      pools: pair.pools.map((candidate) => actualByPool.get(candidate.pool)!),
    })),
    pools: actualCandidates,
  };

  const requiredPrograms = new Map<Address, MimirBetaCaptureExecutableProgramRole>();
  for (const candidate of actualCandidates) requiredPrograms.set(candidate.programId, "source-program");
  for (const [program, role] of [
    [deployment.agentRegistryProgramId, "agent-registry-program"],
    [deployment.mplCoreProgramId, "mpl-core-program"],
  ] as const) {
    if (requiredPrograms.has(program)) betaError("CAPTURE_PLAN_MISMATCH", "executable program roles alias", program);
    requiredPrograms.set(program, role);
  }
  if (preGma.programs.length !== requiredPrograms.size) betaError("CAPTURE_PLAN_MISMATCH", "program relation set size differs");
  const relationAddresses = new Set<Address>();
  const actualPrograms: MimirBetaCaptureProgramRelation[] = [];
  for (const expectedRelation of preGma.programs) {
    const program = checkedAddress(expectedRelation.program, "program relation program");
    const programData = checkedAddress(expectedRelation.programData, "program relation ProgramData");
    const role = requiredPrograms.get(program);
    if (!role || expectedRelation.roles.length !== 1 || expectedRelation.roles[0] !== role ||
        expectedRelation.loader !== MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID || expectedRelation.programDataElfOffset !== 45 ||
        !Number.isSafeInteger(expectedRelation.programDataElfLength) || expectedRelation.programDataElfLength <= 0 ||
        !/^[0-9a-f]{64}$/.test(expectedRelation.programDataElfSha256) || relationAddresses.has(program) ||
        relationAddresses.has(programData) || program === programData) {
      betaError("CAPTURE_PLAN_MISMATCH", "program relation expectation differs from required executable closure", program);
    }
    relationAddresses.add(program); relationAddresses.add(programData);
    const programRow = rows.get(program); const programDataRow = rows.get(programData);
    if (!programRow || !programDataRow) betaError("CAPTURE_PLAN_MISMATCH", "program relation row is missing", program);
    const decoded = decodeUpgradeableProgramRelation(programRow, programDataRow);
    const elfKey = `${decoded.programDataAddress}:${new DataView(programDataRow.data.buffer, programDataRow.data.byteOffset).getBigUint64(4, true)}`;
    let elf = decoded.elfBytes.length ? undefined : PROGRAM_DATA_ELF.get(elfKey);
    if (!elf) {
      if (!decoded.elfBytes.length) betaError("ACCOUNT_MALFORMED", "header-only ProgramData has no known ELF digest", programData);
      elf = Object.freeze({ length: decoded.elfBytes.length, sha256: hex(await sha256(decoded.elfBytes)) });
      if (!PROGRAM_DATA_ELF.has(elfKey)) PROGRAM_DATA_ELF.set(elfKey, elf);
    }
    const actual: MimirBetaCaptureProgramRelation = {
      program,
      programData: decoded.programDataAddress,
      loader: MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID,
      programDataElfOffset: 45,
      programDataElfLength: elf.length,
      programDataElfSha256: elf.sha256,
      roles: [role],
    };
    requireCanonicalEqual(actual, expectedRelation, "program relation changed");
    actualPrograms.push(actual);
  }
  actualPrograms.sort((left, right) => compareAddressBytes(left.program, right.program));
  requireCanonicalEqual(actualPrograms, preGma.programs, "program relations are not in exact canonical order");

  const identity = createMimir8004IdentityAdapter(deployment);
  const [[rootAddress], [registryAddress]] = await Promise.all([
    identity.deriveRootConfig(), identity.deriveRegistryConfig(),
  ]);
  const rootRow = rows.get(rootAddress); const registryRow = rows.get(registryAddress);
  if (!rootRow || !registryRow) betaError("CAPTURE_PLAN_MISMATCH", "8004 config row is missing");
  for (const row of [rootRow, registryRow]) {
    if (row.owner !== deployment.agentRegistryProgramId) betaError("ACCOUNT_OWNER_MISMATCH", "8004 config owner mismatch", row.address);
    if (row.executable) betaError("ACCOUNT_MALFORMED", "8004 config must not be executable", row.address);
  }
  const root = decodeMimir8004RootConfig(rootRow.data);
  const registry = decodeMimir8004RegistryConfig(registryRow.data);
  requireCanonicalEqual(root, trust.rootConfig, "8004 Root config changed");
  requireCanonicalEqual(registry, trust.registryConfig, "8004 Registry config changed");
  await verifyMimir8004ConfigPdas({ adapter: identity, rootAddress, root, registryAddress, registry });

  const collectionRow = rows.get(deployment.physicalCollection);
  if (!collectionRow) betaError("CAPTURE_PLAN_MISMATCH", "physical Core collection row is missing", deployment.physicalCollection);
  const collection = decodeMimirBetaCoreCollection(collectionRow, deployment);
  if (collection.updateAuthority !== registryAddress) betaError("IDENTITY_UNVERIFIED", "physical Core collection update authority mismatch", collectionRow.address);

  type RoleAccumulator = { roles: Set<MimirBetaCaptureRole>; derivedFrom: Set<Address>; closure: boolean };
  const graph = new Map<Address, RoleAccumulator>();
  const addPlanRole = (nodeAddress: Address, role: MimirBetaCaptureRole, derivedFrom: readonly Address[]): void => {
    const canonicalAddress = checkedAddress(nodeAddress, "role graph address");
    const accumulator = graph.get(canonicalAddress) ?? { roles: new Set(), derivedFrom: new Set(), closure: false };
    if (accumulator.closure) betaError("CAPTURE_PLAN_MISMATCH", "plan role aliases trust/program closure", canonicalAddress);
    accumulator.roles.add(role);
    for (const dependency of derivedFrom) accumulator.derivedFrom.add(checkedAddress(dependency, "role graph dependency"));
    graph.set(canonicalAddress, accumulator);
  };
  const addClosureRole = (nodeAddress: Address, role: MimirBetaCaptureRole, derivedFrom: readonly Address[]): void => {
    const canonicalAddress = checkedAddress(nodeAddress, "closure role address");
    if (graph.has(canonicalAddress)) betaError("CAPTURE_PLAN_MISMATCH", "trust/program closure address aliases another role", canonicalAddress);
    graph.set(canonicalAddress, {
      roles: new Set([role]),
      derivedFrom: new Set(derivedFrom.map((dependency) => checkedAddress(dependency, "closure dependency"))),
      closure: true,
    });
  };
  for (const candidate of actualCohort.pools) {
    const plan = selected.get(candidate.pool)!.expectedPlan;
    addPlanRole(candidate.pool, "pool", [candidate.programId]);
    for (const node of plan.auxiliary) addPlanRole(node.address, node.role, node.derivedFrom);
  }
  for (const relation of actualPrograms) {
    const programRole = relation.roles[0];
    const dataRole = programRole === "source-program" ? "source-program-data" :
      programRole === "agent-registry-program" ? "agent-registry-program-data" : "mpl-core-program-data";
    addClosureRole(relation.program, programRole, []);
    addClosureRole(relation.programData, dataRole, [relation.program]);
  }
  addClosureRole(rootAddress, "8004-root-config", [deployment.agentRegistryProgramId]);
  addClosureRole(registryAddress, "8004-registry-config", [deployment.agentRegistryProgramId, deployment.physicalCollection]);
  addClosureRole(deployment.physicalCollection, "physical-core-collection", [deployment.mplCoreProgramId, registryAddress]);

  const actualRoleGraph: MimirBetaCaptureRoleNode[] = [...graph.entries()].map(([nodeAddress, node]) => ({
    address: nodeAddress,
    roles: [...node.roles].sort(compareAscii) as [MimirBetaCaptureRole, ...MimirBetaCaptureRole[]],
    derivedFrom: [...node.derivedFrom].sort(compareAddressBytes),
  })).sort((left, right) => compareAddressBytes(left.address, right.address));
  requireCanonicalEqual(actualRoleGraph, preGma.roleGraph, "global role graph changed");

  const addresses = [...rows.keys()].sort(compareAddressBytes);
  const graphAddresses = actualRoleGraph.map((node) => node.address);
  requireCanonicalEqual(addresses, graphAddresses, "global account set differs from closed role graph");

  return freshDeepFrozen({
    schema: "mimir-beta-capture-revalidation-v1" as const,
    cohort: actualCohort,
    planAddresses: planUnion,
    addresses,
    roleGraph: actualRoleGraph,
    programs: actualPrograms,
  });
}

export interface MimirBetaUpgradeableAccount {
  readonly address: Address;
  readonly owner: Address;
  readonly executable: boolean;
  readonly data: Uint8Array;
}

const PROGRAM_DATA_ELF = new Map<string, Readonly<{ length: number; sha256: string }>>([
  ["DMawCQzbgNTmbzaESc7o6pvL1KAeetY8zA7jNpzntHhU:452376460", { length: 793_824, sha256: "b6dbea8cefc2e7d490775ce6115e34a2ba480c0853c359e0bb4043b9381ef09a" }],
  ["AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH:445230614", { length: 2_174_352, sha256: "4d5b920baebc090f89b2e8796a3452ed067c9667a143058c96a312f2c1e6848b" }],
  ["CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD:440170207", { length: 10_485_715, sha256: "610b1e394973bd1b86de8afc983524bd21dea177e87bfae75ec289d4c350f9ae" }],
  ["HZcJwcJ2njPDxZtpPoKnF8v2w9QAx2rS7TdJPSRkbEhu:423977638", { length: 2_229_776, sha256: "d296c6771cec945601027613ca637c1be6721044c5859009d41c453477844c1f" }],
]);

export function decodeUpgradeableProgramRelation(
  program: MimirBetaUpgradeableAccount,
  programData: MimirBetaUpgradeableAccount,
): Readonly<{ programDataAddress: Address; elfBytes: Uint8Array }> {
  if (program.owner !== MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID || !program.executable || program.data.length !== 36 || u32(program.data, 0) !== 2) {
    betaError("ACCOUNT_MALFORMED", "invalid upgradeable Program account", program.address);
  }
  const embedded = key(program.data, 4);
  const authorityOption = programData.data[12];
  const canonicalOption = authorityOption === 1
    ? !isZeroBytes(programData.data.subarray(13, 45))
    : authorityOption === 0 && isZeroBytes(programData.data.subarray(13, 45));
  if (programData.address !== embedded || programData.owner !== MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID || programData.executable ||
      programData.data.length < 45 || u32(programData.data, 0) !== 3 || !canonicalOption) {
    betaError("ACCOUNT_MALFORMED", "invalid upgradeable ProgramData relation", programData.address);
  }
  return Object.freeze({ programDataAddress: embedded, elfBytes: programData.data.slice(45) });
}
