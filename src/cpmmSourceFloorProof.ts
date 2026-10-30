import { PublicKey } from "@solana/web3.js";
import {
  RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_0,
  RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_1,
  RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_0,
  RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_1,
  RAYDIUM_CPMM_POOL_OFFSET_OPEN_TIME,
  RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_0,
  RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_1,
  RAYDIUM_CPMM_POOL_OFFSET_STATUS,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM,
  RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT,
  RAYDIUM_CPMM_POOL_STATE_LEN,
  RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK,
} from "./constants.js";
import { freshCanonicalAuthority } from "./internal/canonicalAuthority.js";
import { decodeSourceConfigHeader, verifySourceConfigHeader } from "./codec.js";
import { cpmmZeroFeeImmediateUnwindBounds } from "./math.js";
import { findSourceConfigPda } from "./pda.js";

const {
  MIMIR_PROGRAM_ID: CANONICAL_MIMIR_PROGRAM_ID,
  RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
  SPL_NATIVE_MINT_ID,
  SPL_TOKEN_PROGRAM_ID: CANONICAL_SPL_TOKEN_PROGRAM_ID,
  SourceAdapterType,
  SourceDirection,
} = freshCanonicalAuthority(PublicKey);

const SPL_TOKEN_ACCOUNT_LEN = 165;
const U64_MAX = (1n << 64n) - 1n;

export interface CpmmSourceFloorContextualAccount {
  address: PublicKey;
  owner: PublicKey;
  data: Uint8Array;
  contextSlot: bigint;
}

export type CpmmSourceFloorUnavailableReason =
  | "context_mismatch"
  | "invalid_source_config"
  | "unsupported_adapter"
  | "invalid_pool"
  | "invalid_vault"
  | "arithmetic";

export interface CpmmSourceFloorMetrics {
  contextSlot: bigint;
  sourceConfigRevision: bigint;
  sourceSetRevision: bigint;
  direction: 0 | 1;
  token0IsBase: boolean;
  baseReserve: bigint;
  quoteReserve: bigint;
  baseFees: bigint;
  quoteFees: bigint;
  liquidityNative: bigint;
  depthTo50BpsNative: bigint;
  minLiquidityNative: bigint;
  minDepthTo50BpsNative: bigint;
}

interface CpmmSourceFloorScope {
  proofScope: "cpmm_source_floor_only";
  actionabilityRequirement: "requires_atomic_topology_validated";
}

export type CpmmSourceFloorProof = CpmmSourceFloorScope & (
  | ({ status: "source_floor_validated" } & CpmmSourceFloorMetrics)
  | ({
      status: "below_minimum";
      belowLiquidityMinimum: boolean;
      belowDepthMinimum: boolean;
    } & CpmmSourceFloorMetrics)
  | {
      status: "unavailable";
      reason: CpmmSourceFloorUnavailableReason;
    }
);

export interface InspectCpmmSourceFloorProofParams {
  expectedFeedId: Uint8Array;
  expectedSourceIndex: number;
  expectedCpmmProgramId: PublicKey;
  currentUnixTs: bigint;
  sourceConfig: CpmmSourceFloorContextualAccount;
  pool: CpmmSourceFloorContextualAccount;
  baseVault: CpmmSourceFloorContextualAccount;
  quoteVault: CpmmSourceFloorContextualAccount;
  mimirProgramId?: PublicKey;
}

class CpmmSourceFloorUnavailable extends Error {
  constructor(readonly reason: CpmmSourceFloorUnavailableReason) {
    super(reason);
  }
}

function fail(reason: CpmmSourceFloorUnavailableReason): never {
  throw new CpmmSourceFloorUnavailable(reason);
}

function key(data: Buffer, offset: number): PublicKey {
  if (offset < 0 || offset + 32 > data.length) fail("invalid_pool");
  return new PublicKey(data.subarray(offset, offset + 32));
}

function strictVault(args: {
  account: CpmmSourceFloorContextualAccount;
  expectedAddress: PublicKey;
  expectedMint: PublicKey;
  expectedAuthority: PublicKey;
}): bigint {
  if (
    !args.account.address.equals(args.expectedAddress) ||
    !args.account.owner.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) ||
    args.account.data.length !== SPL_TOKEN_ACCOUNT_LEN
  ) {
    fail("invalid_vault");
  }
  const data = Buffer.from(args.account.data);
  const isNative = data.readUInt32LE(109);
  if (
    !key(data, 0).equals(args.expectedMint) ||
    !key(data, 32).equals(args.expectedAuthority) ||
    data.readUInt32LE(72) !== 0 ||
    data[108] !== 1 ||
    (isNative !== 0 && !(isNative === 1 && args.expectedMint.equals(SPL_NATIVE_MINT_ID))) ||
    data.readBigUInt64LE(121) !== 0n ||
    data.readUInt32LE(129) !== 0
  ) {
    fail("invalid_vault");
  }
  const amount = data.readBigUInt64LE(64);
  if (amount === 0n) fail("invalid_vault");
  return amount;
}

function feeTotal(data: Buffer, offsets: readonly [number, number, number]): bigint {
  const total = offsets.reduce((sum, offset) => sum + data.readBigUInt64LE(offset), 0n);
  if (total > U64_MAX) fail("arithmetic");
  return total;
}

const SCOPE: CpmmSourceFloorScope = {
  proofScope: "cpmm_source_floor_only",
  actionabilityRequirement: "requires_atomic_topology_validated",
};

/**
 * Produces a partial CP-Swap source-floor proof from one contextual account read.
 * This never proves market actionability by itself: consumers must additionally
 * require their independent atomic-topology proof to be validated.
 */
export function inspectCpmmSourceFloorProof(
  args: InspectCpmmSourceFloorProofParams,
): CpmmSourceFloorProof {
  try {
    const contextSlot = args.sourceConfig.contextSlot;
    if (
      contextSlot <= 0n ||
      [args.pool, args.baseVault, args.quoteVault].some(
        (account) => account.contextSlot !== contextSlot,
      )
    ) {
      fail("context_mismatch");
    }
    const mimirProgramId = args.mimirProgramId ?? CANONICAL_MIMIR_PROGRAM_ID;
    if (args.currentUnixTs < 0n || !args.sourceConfig.owner.equals(mimirProgramId)) {
      fail("invalid_source_config");
    }

    let sourceConfig;
    try {
      sourceConfig = decodeSourceConfigHeader(args.sourceConfig.data);
      verifySourceConfigHeader(
        sourceConfig,
        args.expectedFeedId,
        args.expectedSourceIndex,
      );
    } catch {
      fail("invalid_source_config");
    }
    const [expectedSourceConfig, expectedBump] = findSourceConfigPda(
      args.expectedFeedId,
      args.expectedSourceIndex,
      mimirProgramId,
    );
    if (
      !args.sourceConfig.address.equals(expectedSourceConfig) ||
      sourceConfig.bump !== expectedBump
    ) {
      fail("invalid_source_config");
    }
    if (sourceConfig.adapterType !== SourceAdapterType.RaydiumCpmm) {
      fail("unsupported_adapter");
    }
    if (
      sourceConfig.direction !== SourceDirection.BasePerQuote &&
      sourceConfig.direction !== SourceDirection.QuotePerBase
    ) {
      fail("invalid_source_config");
    }

    const sourceProgram = new PublicKey(sourceConfig.programId);
    const tokenProgram = new PublicKey(sourceConfig.tokenProgram);
    const poolAddress = new PublicKey(sourceConfig.poolOrMarket);
    const baseVaultAddress = new PublicKey(sourceConfig.baseVault);
    const quoteVaultAddress = new PublicKey(sourceConfig.quoteVault);
    const baseMint = new PublicKey(sourceConfig.baseMint);
    const quoteMint = new PublicKey(sourceConfig.quoteMint);
    const vaultAuthority = new PublicKey(sourceConfig.vaultAuthority);
    if (
      !args.expectedCpmmProgramId.equals(RAYDIUM_CPMM_MAINNET_PROGRAM_ID) ||
      !sourceProgram.equals(args.expectedCpmmProgramId) ||
      !tokenProgram.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) ||
      baseVaultAddress.equals(quoteVaultAddress)
    ) {
      fail("invalid_source_config");
    }

    const pool = Buffer.from(args.pool.data);
    if (
      !args.pool.address.equals(poolAddress) ||
      !args.pool.owner.equals(sourceProgram) ||
      pool.length !== RAYDIUM_CPMM_POOL_STATE_LEN ||
      !pool.subarray(0, RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR.length)
        .equals(RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR) ||
      (pool[RAYDIUM_CPMM_POOL_OFFSET_STATUS]! &
        RAYDIUM_CPMM_STATUS_SWAP_DISABLED_MASK) !== 0 ||
      pool.readBigUInt64LE(RAYDIUM_CPMM_POOL_OFFSET_OPEN_TIME) > args.currentUnixTs
    ) {
      fail("invalid_pool");
    }
    const token0Vault = key(pool, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT);
    const token1Vault = key(pool, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT);
    const token0Mint = key(pool, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT);
    const token1Mint = key(pool, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT);
    const token0Program = key(pool, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM);
    const token1Program = key(pool, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM);
    const token0IsBase =
      token0Vault.equals(baseVaultAddress) &&
      token1Vault.equals(quoteVaultAddress) &&
      token0Mint.equals(baseMint) &&
      token1Mint.equals(quoteMint);
    const token1IsBase =
      token1Vault.equals(baseVaultAddress) &&
      token0Vault.equals(quoteVaultAddress) &&
      token1Mint.equals(baseMint) &&
      token0Mint.equals(quoteMint);
    if (
      (!token0IsBase && !token1IsBase) ||
      !token0Program.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID) ||
      !token1Program.equals(CANONICAL_SPL_TOKEN_PROGRAM_ID)
    ) {
      fail("invalid_pool");
    }

    const grossBase = strictVault({
      account: args.baseVault,
      expectedAddress: baseVaultAddress,
      expectedMint: baseMint,
      expectedAuthority: vaultAuthority,
    });
    const grossQuote = strictVault({
      account: args.quoteVault,
      expectedAddress: quoteVaultAddress,
      expectedMint: quoteMint,
      expectedAuthority: vaultAuthority,
    });
    const token0Fees = feeTotal(pool, [
      RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_0,
      RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_0,
      RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_0,
    ]);
    const token1Fees = feeTotal(pool, [
      RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_1,
      RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_1,
      RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_1,
    ]);
    const baseFees = token0IsBase ? token0Fees : token1Fees;
    const quoteFees = token0IsBase ? token1Fees : token0Fees;
    if (grossBase <= baseFees || grossQuote <= quoteFees) fail("invalid_vault");

    const baseReserve = grossBase - baseFees;
    const quoteReserve = grossQuote - quoteFees;
    const liquidityNative = baseReserve < quoteReserve ? baseReserve : quoteReserve;
    const depthTo50BpsNative = cpmmZeroFeeImmediateUnwindBounds(
      baseReserve,
      quoteReserve,
      50,
    ).capitalRequiredFloor;
    const metrics: CpmmSourceFloorMetrics = {
      contextSlot,
      sourceConfigRevision: sourceConfig.sourceConfigRevision,
      sourceSetRevision: sourceConfig.sourceSetRevision,
      direction: sourceConfig.direction,
      token0IsBase,
      baseReserve,
      quoteReserve,
      baseFees,
      quoteFees,
      liquidityNative,
      depthTo50BpsNative,
      minLiquidityNative: sourceConfig.minLiquidityNative,
      minDepthTo50BpsNative: sourceConfig.minDepthTo50BpsNative,
    };
    const belowLiquidityMinimum = liquidityNative < sourceConfig.minLiquidityNative;
    const belowDepthMinimum =
      depthTo50BpsNative < sourceConfig.minDepthTo50BpsNative;
    return belowLiquidityMinimum || belowDepthMinimum
      ? {
          ...SCOPE,
          status: "below_minimum",
          belowLiquidityMinimum,
          belowDepthMinimum,
          ...metrics,
        }
      : { ...SCOPE, status: "source_floor_validated", ...metrics };
  } catch (error) {
    return {
      ...SCOPE,
      status: "unavailable",
      reason: error instanceof CpmmSourceFloorUnavailable ? error.reason : "arithmetic",
    };
  }
}
