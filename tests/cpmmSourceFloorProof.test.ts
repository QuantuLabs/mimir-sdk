import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import {
  MIMIR_MAINNET_USDC_MINT,
  MIMIR_PROGRAM_ID,
  RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
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
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
  RAYDIUM_CPMM_POOL_STATE_LEN,
  SOURCE_OFFSETS,
  SPL_TOKEN_PROGRAM_ID,
  SourceAdapterType,
  SourceDirection,
  SourceStatus,
} from "../src/constants.js";
import {
  inspectCpmmSourceFloorProof,
  type CpmmSourceFloorContextualAccount,
  type InspectCpmmSourceFloorProofParams,
} from "../src/cpmmSourceFloorProof.js";
import { buildTestCpmmSourceConfigHeader, TEST_FEED_ID } from "../src/fixtures.js";
import { cpmmZeroFeeImmediateUnwindBounds } from "../src/math.js";
import { findSourceConfigPda } from "../src/pda.js";

const CONTEXT_SLOT = 477_000_000n;
const NOW = 1_789_000_000n;
const BASE_MINT = new PublicKey(new Uint8Array(32).fill(10));
const QUOTE_MINT = MIMIR_MAINNET_USDC_MINT;

function writeU128(data: Buffer, offset: number, value: bigint): void {
  data.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  data.writeBigUInt64LE(value >> 64n, offset + 8);
}

function tokenAccount(mint: PublicKey, authority: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  authority.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

function contextual(
  address: PublicKey,
  owner: PublicKey,
  data: Buffer,
): CpmmSourceFloorContextualAccount {
  return { address, owner, data, contextSlot: CONTEXT_SLOT };
}

function fixture(token0IsBase = true): InspectCpmmSourceFloorProofParams {
  const pool = new PublicKey(new Uint8Array(32).fill(51));
  const baseVault = new PublicKey(new Uint8Array(32).fill(52));
  const quoteVault = new PublicKey(new Uint8Array(32).fill(53));
  const vaultAuthority = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_and_lp_mint_auth_seed", "ascii")],
    RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
  )[0];
  const sourceConfigData = buildTestCpmmSourceConfigHeader(0, (data) => {
    pool.toBuffer().copy(data, SOURCE_OFFSETS.poolOrMarket);
    baseVault.toBuffer().copy(data, SOURCE_OFFSETS.baseVault);
    quoteVault.toBuffer().copy(data, SOURCE_OFFSETS.quoteVault);
    BASE_MINT.toBuffer().copy(data, SOURCE_OFFSETS.baseMint);
    QUOTE_MINT.toBuffer().copy(data, SOURCE_OFFSETS.quoteMint);
    data[SOURCE_OFFSETS.direction] = SourceDirection.BasePerQuote;
    writeU128(data, SOURCE_OFFSETS.minLiquidityNative, 1n);
    writeU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, 1n);
  });
  const poolData = Buffer.alloc(RAYDIUM_CPMM_POOL_STATE_LEN);
  RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR.copy(poolData, 0);
  const token0Vault = token0IsBase ? baseVault : quoteVault;
  const token1Vault = token0IsBase ? quoteVault : baseVault;
  const token0Mint = token0IsBase ? BASE_MINT : QUOTE_MINT;
  const token1Mint = token0IsBase ? QUOTE_MINT : BASE_MINT;
  token0Vault.toBuffer().copy(poolData, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT);
  token1Vault.toBuffer().copy(poolData, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_VAULT);
  token0Mint.toBuffer().copy(poolData, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT);
  token1Mint.toBuffer().copy(poolData, RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_MINT);
  SPL_TOKEN_PROGRAM_ID.toBuffer().copy(
    poolData,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_PROGRAM,
  );
  SPL_TOKEN_PROGRAM_ID.toBuffer().copy(
    poolData,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_1_PROGRAM,
  );
  poolData[RAYDIUM_CPMM_POOL_OFFSET_STATUS] = 0;
  poolData.writeBigUInt64LE(NOW, RAYDIUM_CPMM_POOL_OFFSET_OPEN_TIME);

  const baseFees = { protocol: 10n, fund: 20n, creator: 1_000n };
  const quoteFees = { protocol: 100n, fund: 200n, creator: 100_000n };
  const token0Fees = token0IsBase ? baseFees : quoteFees;
  const token1Fees = token0IsBase ? quoteFees : baseFees;
  poolData.writeBigUInt64LE(
    token0Fees.protocol,
    RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_0,
  );
  poolData.writeBigUInt64LE(
    token1Fees.protocol,
    RAYDIUM_CPMM_POOL_OFFSET_PROTOCOL_FEES_TOKEN_1,
  );
  poolData.writeBigUInt64LE(token0Fees.fund, RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_0);
  poolData.writeBigUInt64LE(token1Fees.fund, RAYDIUM_CPMM_POOL_OFFSET_FUND_FEES_TOKEN_1);
  poolData.writeBigUInt64LE(
    token0Fees.creator,
    RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_0,
  );
  poolData.writeBigUInt64LE(
    token1Fees.creator,
    RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_1,
  );

  return {
    expectedFeedId: TEST_FEED_ID,
    expectedSourceIndex: 0,
    expectedCpmmProgramId: RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
    currentUnixTs: NOW,
    sourceConfig: contextual(
      findSourceConfigPda(TEST_FEED_ID, 0)[0],
      MIMIR_PROGRAM_ID,
      sourceConfigData,
    ),
    pool: contextual(pool, RAYDIUM_CPMM_MAINNET_PROGRAM_ID, poolData),
    baseVault: contextual(
      baseVault,
      SPL_TOKEN_PROGRAM_ID,
      tokenAccount(BASE_MINT, vaultAuthority, 1_000_000_001_030n),
    ),
    quoteVault: contextual(
      quoteVault,
      SPL_TOKEN_PROGRAM_ID,
      tokenAccount(QUOTE_MINT, vaultAuthority, 1_100_300n),
    ),
  };
}

for (const token0IsBase of [true, false]) {
  const args = fixture(token0IsBase);
  const result = inspectCpmmSourceFloorProof(args);
  assert.equal(result.status, "source_floor_validated");
  if (result.status !== "source_floor_validated") throw new Error("expected proof");
  assert.equal(result.proofScope, "cpmm_source_floor_only");
  assert.equal(result.actionabilityRequirement, "requires_atomic_topology_validated");
  assert.equal(result.token0IsBase, token0IsBase);
  assert.equal(result.baseFees, 1_030n);
  assert.equal(result.quoteFees, 100_300n);
  assert.equal(result.baseReserve, 1_000_000_000_000n);
  assert.equal(result.quoteReserve, 1_000_000n);
  assert.equal(
    result.depthTo50BpsNative,
    cpmmZeroFeeImmediateUnwindBounds(1_000_000_000_000n, 1_000_000n, 50)
      .capitalRequiredFloor,
  );
}

{
  const args = fixture();
  writeU128(args.sourceConfig.data as Buffer, SOURCE_OFFSETS.minDepthTo50BpsNative, 2_497n);
  const result = inspectCpmmSourceFloorProof(args);
  assert.equal(result.status, "below_minimum");
  if (result.status !== "below_minimum") throw new Error("expected below minimum");
  assert.equal(result.depthTo50BpsNative, 2_496n);
  assert.equal(result.belowDepthMinimum, true);
  assert.equal(result.belowLiquidityMinimum, false);
}

function expectUnavailable(
  mutate: (args: InspectCpmmSourceFloorProofParams) => void,
  reason: string,
): void {
  const args = fixture();
  mutate(args);
  assert.deepEqual(inspectCpmmSourceFloorProof(args), {
    proofScope: "cpmm_source_floor_only",
    actionabilityRequirement: "requires_atomic_topology_validated",
    status: "unavailable",
    reason,
  });
}

expectUnavailable(
  (args) => ((args.sourceConfig.data as Buffer)[SOURCE_OFFSETS.status] = SourceStatus.Paused),
  "invalid_source_config",
);
expectUnavailable(
  (args) => (args.sourceConfig.data as Buffer).writeUInt16LE(1, SOURCE_OFFSETS.adapterVersion),
  "invalid_source_config",
);
expectUnavailable(
  (args) => (args.sourceConfig.data as Buffer).writeBigUInt64LE(0n, SOURCE_OFFSETS.sourceSetRevision),
  "invalid_source_config",
);
expectUnavailable(
  (args) => (args.sourceConfig.data as Buffer).writeBigUInt64LE(
    0n,
    SOURCE_OFFSETS.sourceConfigRevision,
  ),
  "invalid_source_config",
);
expectUnavailable(
  (args) => ((args.sourceConfig.data as Buffer)[SOURCE_OFFSETS.bump] ^= 1),
  "invalid_source_config",
);
expectUnavailable(
  (args) => {
    args.quoteVault.contextSlot += 1n;
  },
  "context_mismatch",
);
expectUnavailable(
  (args) => {
    args.sourceConfig.owner = new PublicKey(new Uint8Array(32).fill(90));
  },
  "invalid_source_config",
);
expectUnavailable(
  (args) => {
    args.pool.owner = new PublicKey(new Uint8Array(32).fill(91));
  },
  "invalid_pool",
);
expectUnavailable(
  (args) => {
    (args.pool.data as Buffer)[RAYDIUM_CPMM_POOL_OFFSET_STATUS] = 4;
  },
  "invalid_pool",
);
expectUnavailable(
  (args) => {
    args.baseVault.owner = new PublicKey(new Uint8Array(32).fill(92));
  },
  "invalid_vault",
);
expectUnavailable(
  (args) => new PublicKey(new Uint8Array(32).fill(93)).toBuffer().copy(
    args.pool.data as Buffer,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_MINT,
  ),
  "invalid_pool",
);
expectUnavailable(
  (args) => new PublicKey(new Uint8Array(32).fill(94)).toBuffer().copy(
    args.baseVault.data as Buffer,
    0,
  ),
  "invalid_vault",
);
expectUnavailable(
  (args) => {
    (args.baseVault.data as Buffer)[108] = 2;
  },
  "invalid_vault",
);
expectUnavailable(
  (args) => new PublicKey(new Uint8Array(32).fill(95)).toBuffer().copy(
    args.pool.data as Buffer,
    RAYDIUM_CPMM_POOL_OFFSET_TOKEN_0_VAULT,
  ),
  "invalid_pool",
);
expectUnavailable(
  (args) => {
    (args.sourceConfig.data as Buffer)[SOURCE_OFFSETS.adapterType] =
      SourceAdapterType.OrcaWhirlpool;
  },
  "unsupported_adapter",
);
expectUnavailable(
  (args) => {
    (args.sourceConfig.data as Buffer)[SOURCE_OFFSETS.direction] = 2;
  },
  "invalid_source_config",
);
expectUnavailable(
  (args) => {
    (args.pool.data as Buffer).writeBigUInt64LE(
      1_100_300n,
      RAYDIUM_CPMM_POOL_OFFSET_CREATOR_FEES_TOKEN_1,
    );
  },
  "invalid_vault",
);

console.log("cpmm source-floor proof tests passed");
