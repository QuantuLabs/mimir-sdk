import type { Address } from "@solana/kit";
import { getProgramDerivedAddressCached } from "./pdaMemo.js";
import { addressBytes, bytesAddress, bytesEqual, hex, isZeroBytes, sha256, utf8 } from "./bytes.js";
import { betaError } from "./errors.js";
import { sourceAdapterSupportsVersion, type MimirBetaAccount } from "./types.js";

const REGISTRY_MAGIC = utf8("MIMIRREG");
const ADMIN_MAGIC = utf8("MIMIRCFG");
const MAX_ACTIVATION_FEE_LAMPORTS = 100_000_000n;

export interface MimirBetaRegistryContext {
  readonly address: Address;
  readonly authority: Address;
  /** @deprecated Reserved; zero on current mainnet registries. */
  readonly emergencyAuthority: Address | null;
  readonly supportedAdapterMask: bigint;
  readonly supportedAdapterVersionMasks: readonly number[];
  readonly minFeedConfigVersion: number;
  readonly registryEpoch: bigint;
  readonly status: 0 | 1 | 2;
  readonly bump: number;
  readonly stateHash: Uint8Array;
  readonly stateHashHex: string;
}

export interface MimirBetaAdminContext {
  readonly address: Address;
  readonly adminAuthority: Address;
  readonly collateralMint: Address | null;
  readonly collateralAmountRaw: bigint;
  readonly collateralRequired: boolean;
  readonly closePower: boolean;
  readonly creationOpen: boolean;
  readonly compositeOwnerShareBps: number;
  readonly compositeRefreshFeeLamports: bigint;
  /** CREATE_COMPOSITE activation fees: per component to each child owner, per component to the treasury, per creation to the treasury. */
  readonly compositeActivationOwnerFeeLamports: bigint;
  readonly compositeActivationTreasuryComponentFeeLamports: bigint;
  readonly compositeActivationTreasuryCreationFeeLamports: bigint;
  /** Ticker tariff tenths of the base for lengths 2, 3, 4 and 5-12 (`@116..120`). */
  readonly tickerTierTenths: readonly [number, number, number, number];
  readonly feeTreasury: Address;
  readonly rentRecoveryDestination: Address;
  readonly configRevision: bigint;
  readonly status: 1;
  readonly bump: number;
  readonly stateHash: Uint8Array;
  readonly stateHashHex: string;
}

function malformed(message: string): never { return betaError("ACCOUNT_MALFORMED", message); }
function view(data: Uint8Array): DataView { return new DataView(data.buffer, data.byteOffset, data.byteLength); }
function u16(data: Uint8Array, offset: number): number { return view(data).getUint16(offset, true); }
function u64(data: Uint8Array, offset: number): bigint { return view(data).getBigUint64(offset, true); }
function addressAt(data: Uint8Array, offset: number, label: string, allowZero = false): Address | null {
  const value = data.subarray(offset, offset + 32);
  if (value.length !== 32) malformed(`${label} truncated`);
  if (isZeroBytes(value)) {
    if (allowZero) return null;
    malformed(`${label} is zero`);
  }
  return bytesAddress(value);
}
function exact(data: Uint8Array, length: number, magic: Uint8Array, version: number, label: string): void {
  if (!(data instanceof Uint8Array) || data.length !== length || !bytesEqual(data.subarray(0, 8), magic) ||
    u16(data, 8) !== version || u16(data, 10) !== length) malformed(`${label} tuple invalid`);
}
function zero(data: Uint8Array, start: number, end: number, label: string): void {
  if (!isZeroBytes(data.subarray(start, end))) malformed(`${label} reserved bytes nonzero`);
}
async function stateHash(domain: string, address: Address | null, data: Uint8Array): Promise<Uint8Array> {
  const prefix = utf8(domain);
  const input = new Uint8Array(prefix.length + (address ? 32 : 0) + data.length);
  input.set(prefix, 0);
  if (address) input.set(addressBytes(address), prefix.length);
  input.set(data, prefix.length + (address ? 32 : 0));
  return sha256(input);
}

export async function decodeMimirBetaRegistryContext(address: Address, data: Uint8Array): Promise<MimirBetaRegistryContext> {
  exact(data, 128, REGISTRY_MAGIC, 0, "registry");
  zero(data, 12, 16, "registry flags"); zero(data, 122, 128, "registry tail");
  const supportedAdapterVersionMasks = Array.from({ length: 8 }, (_, index) => u16(data, 106 + index * 2));
  const status = data[104]!;
  if (status > 2) malformed("registry status invalid");
  const hash = await stateHash("MIMIR_FEED_REGISTRY_STATE_V1", address, data);
  return {
    address,
    authority: addressAt(data, 16, "registry authority")!,
    emergencyAuthority: addressAt(data, 48, "registry emergency authority", true),
    supportedAdapterMask: u64(data, 80),
    supportedAdapterVersionMasks,
    minFeedConfigVersion: u16(data, 88),
    registryEpoch: u64(data, 96),
    status: status as 0 | 1 | 2,
    bump: data[105]!,
    stateHash: hash,
    stateHashHex: hex(hash),
  };
}

export async function decodeMimirBetaAdminContext(address: Address, data: Uint8Array): Promise<MimirBetaAdminContext> {
  exact(data, 192, ADMIN_MAGIC, 1, "admin");
  if (data[89]! > 3) malformed("admin flags invalid");
  zero(data, 90, 96, "admin collateral padding");
  const status = data[12]!;
  const collateral = data[88]!;
  if (status !== 1 || collateral > 1) malformed("admin status or collateral flag invalid");
  const collateralMint = addressAt(data, 48, "collateral mint", collateral === 0);
  const collateralAmountRaw = u64(data, 80);
  const ownerShareBps = u16(data, 14); const compositeFee = u64(data, 96);
  const revision = u64(data, 152);
  const activation = [104, 108, 112].map((offset) => BigInt(view(data).getUint32(offset, true)));
  if (activation.some((fee) => fee > MAX_ACTIVATION_FEE_LAMPORTS)) malformed("admin activation fee above cap");
  if (ownerShareBps > 10_000 || revision === 0n ||
    (collateral === 1 && (collateralMint === null || collateralAmountRaw === 0n)) ||
    (collateral === 0 && (collateralMint !== null || collateralAmountRaw !== 0n))) malformed("admin economic fields invalid");
  const hash = await stateHash("MIMIR_FEED_ADMIN_STATE_V1", address, data);
  return {
    address,
    adminAuthority: addressAt(data, 16, "admin authority")!,
    collateralMint,
    collateralAmountRaw,
    collateralRequired: collateral === 1,
    closePower: (data[89]! & 1) !== 0,
    creationOpen: (data[89]! & 2) !== 0,
    compositeOwnerShareBps: ownerShareBps,
    compositeRefreshFeeLamports: compositeFee,
    compositeActivationOwnerFeeLamports: activation[0]!,
    compositeActivationTreasuryComponentFeeLamports: activation[1]!,
    compositeActivationTreasuryCreationFeeLamports: activation[2]!,
    tickerTierTenths: [data[116]!, data[117]!, data[118]!, data[119]!],
    feeTreasury: addressAt(data, 120, "fee treasury")!,
    rentRecoveryDestination: addressAt(data, 160, "rent recovery destination")!,
    configRevision: revision,
    status: status as 1,
    bump: data[13]!,
    stateHash: hash,
    stateHashHex: hex(hash),
  };
}

export async function verifyMimirBetaContextPda(args: {
  readonly programId: Address;
  readonly address: Address;
  readonly seed: string;
  readonly seedValues: readonly Uint8Array[];
  readonly bump: number;
}): Promise<void> {
  const [expected, bump] = await getProgramDerivedAddressCached(args.programId, [utf8(args.seed), ...args.seedValues]);
  if (expected !== args.address || bump !== args.bump) betaError("PDA_MISMATCH", `${args.seed} PDA or bump mismatch`, args.address);
}

export function requireMimirBetaProgramAccount(account: MimirBetaAccount | null, programId: Address, length: number, label: string): MimirBetaAccount {
  if (!account) betaError("CREATION_CONTEXT_REQUIRED", `${label} account missing`);
  if (account.owner !== programId || account.executable) betaError("ACCOUNT_OWNER_MISMATCH", `${label} owner mismatch`, account.address);
  if (account.data.length !== length) betaError("ACCOUNT_MALFORMED", `${label} allocation mismatch`, account.address);
  return account;
}

export function assertMimirBetaActiveCreationContext(args: {
  readonly registry: MimirBetaRegistryContext;
  readonly admin: MimirBetaAdminContext;
}): void {
  if (args.registry.status !== 0 || args.registry.supportedAdapterMask === 0n ||
    (args.registry.supportedAdapterMask & ~0xdfn) !== 0n || args.registry.minFeedConfigVersion > 1 ||
    args.registry.registryEpoch === 0n || args.registry.emergencyAuthority !== null) {
    betaError("PLAN_STALE", "registry not active for current beta lifecycle");
  }
  for (let adapter = 0; adapter < args.registry.supportedAdapterVersionMasks.length; adapter += 1) {
    const enabled = (args.registry.supportedAdapterMask & (1n << BigInt(adapter))) !== 0n;
    const versions = args.registry.supportedAdapterVersionMasks[adapter]!;
    if (!enabled && versions !== 0) betaError("PLAN_STALE", "registry adapter version policy invalid");
    if (enabled && versions !== 0 && versions !== 1 &&
        !(sourceAdapterSupportsVersion(adapter, 1) && versions === 3)) {
      betaError("PLAN_STALE", "registry adapter version policy invalid");
    }
  }
  if (args.admin.status !== 1) betaError("PLAN_STALE", "admin config inactive");
}

export function assertMimirBetaSourceAdapterVersions(args: {
  readonly registry: Pick<MimirBetaRegistryContext, "supportedAdapterMask" | "supportedAdapterVersionMasks">;
  readonly sources: readonly Readonly<{ adapterType: number; adapterVersion: number }>[];
}): void {
  for (const source of args.sources) {
    if (!sourceAdapterSupportsVersion(source.adapterType, source.adapterVersion)) {
      betaError("PLAN_STALE", "requested source adapter version is not enabled by the current registry");
    }
    const adapterBit = 1n << BigInt(source.adapterType);
    const rawMask = args.registry.supportedAdapterVersionMasks[source.adapterType] ?? 0;
    const effectiveMask = rawMask === 0 ? 1 : rawMask;
    if ((args.registry.supportedAdapterMask & adapterBit) === 0n ||
        (effectiveMask & (1 << source.adapterVersion)) === 0) {
      betaError("PLAN_STALE", "requested source adapter version is not enabled by the current registry");
    }
  }
}

export interface MimirBetaSplMintContext {
  readonly address: Address;
  readonly decimals: number;
  readonly supply: bigint;
}

export interface MimirBetaSplTokenAccountContext {
  readonly address: Address;
  readonly mint: Address;
  readonly owner: Address;
  readonly amount: bigint;
}

export function decodeMimirBetaSplMint(account: MimirBetaAccount, tokenProgramId: Address): MimirBetaSplMintContext {
  if (account.owner !== tokenProgramId || account.executable) betaError("ACCOUNT_OWNER_MISMATCH", "SPL mint owner mismatch", account.address);
  if (account.data.length !== 82 || account.data[45] !== 1) betaError("ACCOUNT_MALFORMED", "extension-free initialized SPL mint required", account.address);
  const decimals = account.data[44]!;
  if (decimals > 18) betaError("ACCOUNT_MALFORMED", "SPL mint decimals invalid", account.address);
  return { address: account.address, decimals, supply: u64(account.data, 36) };
}

export function decodeMimirBetaSplTokenAccount(account: MimirBetaAccount, tokenProgramId: Address): MimirBetaSplTokenAccountContext {
  if (account.owner !== tokenProgramId || account.executable) betaError("ACCOUNT_OWNER_MISMATCH", "SPL token account owner mismatch", account.address);
  if (account.data.length !== 165 || account.data[108] !== 1) betaError("ACCOUNT_MALFORMED", "extension-free initialized SPL token account required", account.address);
  return {
    address: account.address,
    mint: addressAt(account.data, 0, "token account mint")!,
    owner: addressAt(account.data, 32, "token account authority")!,
    amount: u64(account.data, 64),
  };
}
