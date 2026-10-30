import { type Address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  decodeMimirBetaCaptureCandidate,
  deriveMimirBetaCaptureReadPlan,
  mimirBetaCaptureScanDescriptors,
  type MimirBetaCaptureCandidate,
  type MimirBetaCapturedAccount,
  type MimirBetaCaptureReadPlan,
} from "./beta/capture.js";
import { bytesAddress } from "./beta/bytes.js";
import {
  decodeSourceConfigHeader,
  verifySourceConfigHeader,
} from "./codec.js";
import { freshCanonicalAuthority } from "./internal/canonicalAuthority.js";
import { findSourceConfigPda } from "./pda.js";

const {
  MIMIR_PROGRAM_ID: CANONICAL_MIMIR_PROGRAM_ID,
  METEORA_DLMM_PROGRAM_ID: CANONICAL_METEORA_DLMM_PROGRAM_ID,
  RAYDIUM_CLMM_MAINNET_PROGRAM_ID: CANONICAL_RAYDIUM_CLMM_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID: CANONICAL_SPL_TOKEN_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID: CANONICAL_TOKEN_2022_PROGRAM_ID,
  SourceAdapterType,
  SourceDirection,
} = freshCanonicalAuthority(PublicKey);

export interface MeteoraDlmmSourceFloorContextualAccount {
  readonly address: PublicKey;
  readonly owner: PublicKey;
  readonly data: Uint8Array;
  readonly executable: boolean;
  readonly contextSlot: bigint;
}

export type MeteoraDlmmSourceFloorUnavailableReason =
  | "context_mismatch"
  | "invalid_source_config"
  | "unsupported_adapter"
  | "invalid_pool"
  | "invalid_capture";

export interface MeteoraDlmmSourceFloorMetrics {
  readonly contextSlot: bigint;
  readonly sourceConfigRevision: bigint;
  readonly sourceSetRevision: bigint;
  readonly direction: "quote-per-base";
  readonly pool: Address;
  readonly programId: Address;
  readonly baseMint: Address;
  readonly quoteMint: Address;
  readonly liquidityNative: bigint;
  readonly depthTo50BpsNative: bigint;
  readonly minLiquidityNative: bigint;
  readonly minDepthTo50BpsNative: bigint;
}

export type RaydiumClmmSourceFloorContextualAccount = MeteoraDlmmSourceFloorContextualAccount;
export type RaydiumClmmSourceFloorUnavailableReason = MeteoraDlmmSourceFloorUnavailableReason;
export type RaydiumClmmSourceFloorMetrics = MeteoraDlmmSourceFloorMetrics;

type SourceFloorProofScopeName = "dlmm_source_floor_only" | "clmm_source_floor_only";
type SourceFloorProofScope<Name extends SourceFloorProofScopeName> = {
  readonly proofScope: Name;
  readonly actionabilityRequirement: "requires_atomic_topology_validated";
};

type SourceFloorProof<Name extends SourceFloorProofScopeName> = SourceFloorProofScope<Name> & (
  | ({ readonly status: "source_floor_validated" } & MeteoraDlmmSourceFloorMetrics)
  | ({
      readonly status: "below_minimum";
      readonly belowLiquidityMinimum: boolean;
      readonly belowDepthMinimum: boolean;
    } & MeteoraDlmmSourceFloorMetrics)
  | {
      readonly status: "unavailable";
      readonly reason: MeteoraDlmmSourceFloorUnavailableReason;
    }
);

export type MeteoraDlmmSourceFloorProof = SourceFloorProof<"dlmm_source_floor_only">;
export type RaydiumClmmSourceFloorProof = SourceFloorProof<"clmm_source_floor_only">;

export interface InspectMeteoraDlmmSourceFloorProofParams {
  readonly expectedFeedId: Uint8Array;
  readonly expectedSourceIndex: number;
  readonly currentUnixTs: bigint;
  readonly sourceConfig: MeteoraDlmmSourceFloorContextualAccount;
  readonly pool: MeteoraDlmmSourceFloorContextualAccount;
  /** Exact capture closure, including the same pool account supplied above. */
  readonly captureAccounts: readonly MeteoraDlmmSourceFloorContextualAccount[];
  readonly mimirProgramId?: PublicKey;
}

export type InspectRaydiumClmmSourceFloorProofParams = InspectMeteoraDlmmSourceFloorProofParams;

type Snapshot = {
  readonly address: PublicKey;
  readonly owner: PublicKey;
  readonly data: Uint8Array;
  readonly executable: boolean;
  readonly contextSlot: bigint;
};

const DLMM_SCOPE: SourceFloorProofScope<"dlmm_source_floor_only"> = {
  proofScope: "dlmm_source_floor_only",
  actionabilityRequirement: "requires_atomic_topology_validated",
};

const CLMM_SCOPE: SourceFloorProofScope<"clmm_source_floor_only"> = {
  proofScope: "clmm_source_floor_only",
  actionabilityRequirement: "requires_atomic_topology_validated",
};

function unavailable<Name extends SourceFloorProofScopeName>(
  scope: SourceFloorProofScope<Name>,
  reason: MeteoraDlmmSourceFloorUnavailableReason,
): SourceFloorProof<Name> {
  return { ...scope, status: "unavailable", reason } as SourceFloorProof<Name>;
}

function snapshot(account: MeteoraDlmmSourceFloorContextualAccount): Snapshot {
  if (!account || !(account.address instanceof PublicKey) || !(account.owner instanceof PublicKey) ||
      !(account.data instanceof Uint8Array) || typeof account.executable !== "boolean" ||
      typeof account.contextSlot !== "bigint") {
    throw new Error("invalid contextual account");
  }
  return {
    address: new PublicKey(account.address.toBytes()),
    owner: new PublicKey(account.owner.toBytes()),
    data: Uint8Array.from(account.data),
    executable: account.executable,
    contextSlot: account.contextSlot,
  };
}

function sameAccount(left: Snapshot, right: Snapshot): boolean {
  return left.address.equals(right.address) && left.owner.equals(right.owner) &&
    left.executable === right.executable && left.contextSlot === right.contextSlot &&
    left.data.length === right.data.length && left.data.every((byte, index) => byte === right.data[index]);
}

function captureAccount(account: Snapshot): MimirBetaCapturedAccount {
  return {
    address: bytesAddress(account.address.toBytes()),
    owner: bytesAddress(account.owner.toBytes()),
    executable: account.executable,
    data: account.data,
  };
}

function sameCandidateIdentity(
  candidate: MimirBetaCaptureCandidate,
  family: "meteora-dlmm" | "raydium-clmm",
  identities: Readonly<{
    programId: Address;
    pool: Address;
    baseMint: Address;
    quoteMint: Address;
    baseVault: Address;
    quoteVault: Address;
    vaultAuthority: Address;
    tokenProgramId: Address;
    adapterVersion: number;
    token2022Mint: Address | null;
  }>,
): boolean {
  return candidate.family === family && candidate.direction === "quote-per-base" &&
    candidate.programId === identities.programId && candidate.pool === identities.pool &&
    candidate.baseMint === identities.baseMint && candidate.quoteMint === identities.quoteMint &&
    candidate.baseVault === identities.baseVault && candidate.quoteVault === identities.quoteVault &&
    candidate.vaultAuthority === identities.vaultAuthority &&
    candidate.tokenProgramId === identities.tokenProgramId &&
    candidate.adapterVersion === identities.adapterVersion &&
    candidate.token2022Mint === identities.token2022Mint;
}

async function inspectSourceFloorProof<Name extends SourceFloorProofScopeName>(
  args: InspectMeteoraDlmmSourceFloorProofParams,
  family: "meteora-dlmm" | "raydium-clmm",
  scope: SourceFloorProofScope<Name>,
): Promise<SourceFloorProof<Name>> {
  let sourceConfig: Snapshot;
  let pool: Snapshot;
  let captureAccounts: Snapshot[];
  let expectedFeedId: Uint8Array;
  let expectedSourceIndex: number;
  let currentUnixTs: bigint;
  let mimirProgramId: PublicKey;
  try {
    // Snapshot every mutable caller byte/key before the first await below.
    sourceConfig = snapshot(args.sourceConfig);
  } catch {
    return unavailable(scope, "invalid_source_config");
  }
  try {
    pool = snapshot(args.pool);
  } catch {
    return unavailable(scope, "invalid_pool");
  }
  try {
    if (!Array.isArray(args.captureAccounts) || !(args.expectedFeedId instanceof Uint8Array) ||
        !(args.mimirProgramId === undefined || args.mimirProgramId instanceof PublicKey)) {
      return unavailable(scope, "invalid_capture");
    }
    captureAccounts = args.captureAccounts.map(snapshot);
    expectedFeedId = Uint8Array.from(args.expectedFeedId);
    expectedSourceIndex = args.expectedSourceIndex;
    currentUnixTs = args.currentUnixTs;
    mimirProgramId = new PublicKey((args.mimirProgramId ?? CANONICAL_MIMIR_PROGRAM_ID).toBytes());
  } catch {
    return unavailable(scope, "invalid_capture");
  }

  if (typeof currentUnixTs !== "bigint" || currentUnixTs < 0n) return unavailable(scope, "context_mismatch");
  const contextSlot = sourceConfig.contextSlot;
  if (contextSlot <= 0n || pool.contextSlot !== contextSlot ||
      captureAccounts.some((account) => account.contextSlot !== contextSlot)) {
    return unavailable(scope, "context_mismatch");
  }

  let header: ReturnType<typeof decodeSourceConfigHeader>;
  try {
    if (sourceConfig.executable || !sourceConfig.owner.equals(mimirProgramId)) {
      return unavailable(scope, "invalid_source_config");
    }
    header = decodeSourceConfigHeader(sourceConfig.data);
    const expectedAdapter = family === "meteora-dlmm"
      ? SourceAdapterType.MeteoraDlmm
      : SourceAdapterType.RaydiumClmm;
    if (header.adapterType !== expectedAdapter) {
      return unavailable(scope, "unsupported_adapter");
    }
    verifySourceConfigHeader(header, expectedFeedId, expectedSourceIndex);
    const [expectedAddress, expectedBump] = findSourceConfigPda(
      expectedFeedId,
      expectedSourceIndex,
      mimirProgramId,
    );
    const canonicalProgram = family === "meteora-dlmm"
      ? CANONICAL_METEORA_DLMM_PROGRAM_ID
      : CANONICAL_RAYDIUM_CLMM_PROGRAM_ID;
    const expectedTokenProgram = family === "meteora-dlmm" || header.adapterVersion === 0
      ? CANONICAL_SPL_TOKEN_PROGRAM_ID
      : CANONICAL_TOKEN_2022_PROGRAM_ID;
    if (!sourceConfig.address.equals(expectedAddress) || header.bump !== expectedBump ||
        header.direction !== SourceDirection.QuotePerBase ||
        !new PublicKey(header.programId).equals(canonicalProgram) ||
        !new PublicKey(header.tokenProgram).equals(expectedTokenProgram) ||
        (family === "raydium-clmm" && header.adapterVersion !== 0 && header.adapterVersion !== 1)) {
      return unavailable(scope, "invalid_source_config");
    }
  } catch {
    return unavailable(scope, "invalid_source_config");
  }

  const sourceProgram = new PublicKey(header.programId);
  if (!pool.address.equals(new PublicKey(header.poolOrMarket)) || pool.executable ||
      !pool.owner.equals(sourceProgram)) {
    return unavailable(scope, "invalid_pool");
  }
  const poolRows = captureAccounts.filter((account) => account.address.equals(pool.address));
  if (poolRows.length !== 1 || !sameAccount(pool, poolRows[0]!)) {
    return unavailable(scope, "invalid_capture");
  }

  const descriptor = mimirBetaCaptureScanDescriptors().find((item) =>
    item.family === family && item.programId === bytesAddress(sourceProgram.toBytes()));
  if (!descriptor || (family === "raydium-clmm" && descriptor.descriptorId !== "raydium-clmm-1544-v1")) {
    return unavailable(scope, "unsupported_adapter");
  }

  let plan: MimirBetaCaptureReadPlan;
  try {
    plan = deriveMimirBetaCaptureReadPlan({
      descriptor,
      primary: captureAccount(pool),
      pair: {
        baseMint: bytesAddress(header.baseMint),
        quoteMint: bytesAddress(header.quoteMint),
      },
      context: { observedSlot: contextSlot, observedUnixTimestamp: currentUnixTs },
    });
  } catch {
    return unavailable(scope, "invalid_pool");
  }

  let candidate: MimirBetaCaptureCandidate;
  try {
    candidate = await decodeMimirBetaCaptureCandidate({
      descriptor,
      pair: { baseMint: plan.baseMint, quoteMint: plan.quoteMint },
      context: { observedSlot: contextSlot, observedUnixTimestamp: currentUnixTs },
      expectedPlan: plan,
      accounts: captureAccounts.map(captureAccount),
    });
  } catch {
    return unavailable(scope, "invalid_capture");
  }

  const identities = {
    programId: bytesAddress(header.programId),
    pool: bytesAddress(header.poolOrMarket),
    baseMint: bytesAddress(header.baseMint),
    quoteMint: bytesAddress(header.quoteMint),
    baseVault: bytesAddress(header.baseVault),
    quoteVault: bytesAddress(header.quoteVault),
    vaultAuthority: bytesAddress(header.vaultAuthority),
    tokenProgramId: bytesAddress(header.tokenProgram),
    adapterVersion: header.adapterVersion,
    token2022Mint: null as Address | null,
  };
  if (family === "raydium-clmm" && header.adapterVersion === 1) {
    if (candidate.token2022Mint !== identities.baseMint && candidate.token2022Mint !== identities.quoteMint) {
      return unavailable(scope, "invalid_capture");
    }
    identities.token2022Mint = candidate.token2022Mint;
  }
  if (!sameCandidateIdentity(candidate, family, identities)) return unavailable(scope, "invalid_capture");

  const metrics: MeteoraDlmmSourceFloorMetrics = {
    contextSlot,
    sourceConfigRevision: header.sourceConfigRevision,
    sourceSetRevision: header.sourceSetRevision,
    direction: "quote-per-base",
    pool: candidate.pool,
    programId: candidate.programId,
    baseMint: candidate.baseMint,
    quoteMint: candidate.quoteMint,
    liquidityNative: candidate.minLiquidityNative,
    depthTo50BpsNative: candidate.minDepthTo50BpsNative,
    minLiquidityNative: header.minLiquidityNative,
    minDepthTo50BpsNative: header.minDepthTo50BpsNative,
  };
  const belowLiquidityMinimum = metrics.liquidityNative < metrics.minLiquidityNative;
  const belowDepthMinimum = metrics.depthTo50BpsNative < metrics.minDepthTo50BpsNative;
  return belowLiquidityMinimum || belowDepthMinimum
    ? { ...scope, status: "below_minimum", belowLiquidityMinimum, belowDepthMinimum, ...metrics }
    : { ...scope, status: "source_floor_validated", ...metrics };
}

/** Proves only that one authenticated native DLMM capture meets its source minima. */
export function inspectMeteoraDlmmSourceFloorProof(
  args: InspectMeteoraDlmmSourceFloorProofParams,
): Promise<MeteoraDlmmSourceFloorProof> {
  return inspectSourceFloorProof(args, "meteora-dlmm", DLMM_SCOPE);
}

/** Proves only that one authenticated native CLMM capture meets its source minima. */
export function inspectRaydiumClmmSourceFloorProof(
  args: InspectRaydiumClmmSourceFloorProofParams,
): Promise<RaydiumClmmSourceFloorProof> {
  return inspectSourceFloorProof(args, "raydium-clmm", CLMM_SCOPE);
}
