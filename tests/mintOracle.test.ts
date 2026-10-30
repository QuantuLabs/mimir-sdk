import assert from "node:assert/strict";
import { PublicKey, type AccountInfo } from "@solana/web3.js";
import {
  METEORA_DLMM_PROGRAM_ID,
  PUMPSWAP_PROGRAM_ID,
  MIMIR_MAINNET_USDC_MINT,
  MIMIR_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG_MAINNET,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID,
  SPL_TOKEN_2022_PROGRAM_ID,
  RAYDIUM_CLMM_MAINNET_PROGRAM_ID,
} from "../src/constants.js";
import {
  buildMintOracleSourceConfigArgs,
  createRpcMintOraclePoolDiscoveryProvider,
  deriveMintPairFeedId,
  discoverMintOraclePoolsForMint,
  resolveMintOracleAccounts,
  verifyMintOraclePoolsWithRpc,
  deriveMintPairFeedIdHex, defaultProgramIdForSourceFamily,
} from "../src/mintOracle.js";
import { PUMPSWAP_REAL_287_POOL } from "./fixtures/pumpswapReal287.js";

const sampleMint = new PublicKey(new Uint8Array(32).fill(30));

{
  const feedId = deriveMintPairFeedId({
    mintAddress: sampleMint,
    quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
    cluster: "mainnet",
  });
  assert.equal(feedId.length, 32);
}

{
  const namespacedFeedId = deriveMintPairFeedId({
    mintAddress: sampleMint,
    quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
    cluster: "mainnet",
    namespace: "cola-feed-v1",
  });
  assert.notEqual(namespacedFeedId.toString("hex"), deriveMintPairFeedId({
    mintAddress: sampleMint,
    quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
    cluster: "mainnet",
  }).toString("hex"));
  assert.throws(() => deriveMintPairFeedId({ mintAddress: sampleMint, quoteMintAddress: MIMIR_MAINNET_USDC_MINT, cluster: "mainnet",
    namespace: "cola-feed-v1", variant: 0 }), /MintOracleVariantWithNamespace/);

  const accounts = resolveMintOracleAccounts({
    mintAddress: sampleMint,
    quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
    cluster: "mainnet",
    namespace: "cola-feed-v1",
    programId: MIMIR_PROGRAM_ID,
    sourceIndices: [0],
  });
  assert.equal(accounts.feedIdHex, namespacedFeedId.toString("hex"));
}

const METEORA_DLMM_LB_PAIR_LEN = 904;
const METEORA_DLMM_BIN_ARRAY_LEN = 10_136;
const METEORA_DLMM_LB_PAIR_OFFSET_ACTIVE_ID = 76;
const METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_X_MINT = 88;
const METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_Y_MINT = 120;
const METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_X = 152;
const METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_Y = 184;
const METEORA_DLMM_LB_PAIR_OFFSET_BIN_STEP = 80;
const METEORA_DLMM_LB_PAIR_OFFSET_STATUS = 82;
const METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_TYPE = 86;
const METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_POINT = 816;
const METEORA_DLMM_BIN_ARRAY_OFFSET_INDEX = 8;
const METEORA_DLMM_BIN_ARRAY_OFFSET_LB_PAIR = 24;
const METEORA_DLMM_BIN_ARRAY_OFFSET_BINS = 56;
const METEORA_DLMM_BIN_ARRAY_BIN_LEN = 144;
const METEORA_DLMM_BIN_OFFSET_AMOUNT_X = 0;
const METEORA_DLMM_BIN_OFFSET_AMOUNT_Y = 8;

function testPk(byte: number): PublicKey {
  return new PublicKey(new Uint8Array(32).fill(byte));
}

function accountInfo(data: Buffer, owner: PublicKey): AccountInfo<Buffer> {
  return {
    data,
    executable: false,
    lamports: 1,
    owner,
    rentEpoch: 0,
  };
}

function i64Le(value: number): Buffer {
  const out = Buffer.alloc(8);
  out.writeBigInt64LE(BigInt(value));
  return out;
}

function tokenVaultData(mint: PublicKey, owner: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  data[108] = 1;
  return data;
}

const dlmmBaseMint = testPk(31);
const dlmmLbPair = testPk(32);
const dlmmBaseVault = testPk(33);
const dlmmQuoteVault = testPk(34);
const dlmmVaultOwner = testPk(35);
const dlmmActiveId = 141;
const dlmmBinArrayIndex = Math.floor(dlmmActiveId / 70);
const [dlmmActiveBinArray] = PublicKey.findProgramAddressSync(
  [
    Buffer.from("bin_array", "ascii"),
    dlmmLbPair.toBuffer(),
    i64Le(dlmmBinArrayIndex),
  ],
  METEORA_DLMM_PROGRAM_ID,
);
const dlmmPairData = Buffer.alloc(METEORA_DLMM_LB_PAIR_LEN);
dlmmPairData.writeInt32LE(dlmmActiveId, METEORA_DLMM_LB_PAIR_OFFSET_ACTIVE_ID);
dlmmPairData.writeUInt16LE(10, METEORA_DLMM_LB_PAIR_OFFSET_BIN_STEP);
dlmmPairData[METEORA_DLMM_LB_PAIR_OFFSET_STATUS] = 0;
dlmmPairData[METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_TYPE] = 1;
dlmmPairData.writeBigUInt64LE(0n, METEORA_DLMM_LB_PAIR_OFFSET_ACTIVATION_POINT);
dlmmBaseMint.toBuffer().copy(dlmmPairData, METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_X_MINT);
MIMIR_MAINNET_USDC_MINT.toBuffer().copy(
  dlmmPairData,
  METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_Y_MINT,
);
dlmmBaseVault.toBuffer().copy(dlmmPairData, METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_X);
dlmmQuoteVault.toBuffer().copy(dlmmPairData, METEORA_DLMM_LB_PAIR_OFFSET_RESERVE_Y);
const dlmmActiveBinArrayData = Buffer.alloc(METEORA_DLMM_BIN_ARRAY_LEN);
dlmmActiveBinArrayData.writeBigInt64LE(
  BigInt(dlmmBinArrayIndex),
  METEORA_DLMM_BIN_ARRAY_OFFSET_INDEX,
);
dlmmLbPair.toBuffer().copy(dlmmActiveBinArrayData, METEORA_DLMM_BIN_ARRAY_OFFSET_LB_PAIR);
const dlmmActiveBinOffset =
  METEORA_DLMM_BIN_ARRAY_OFFSET_BINS +
  (dlmmActiveId - dlmmBinArrayIndex * 70) * METEORA_DLMM_BIN_ARRAY_BIN_LEN;
dlmmActiveBinArrayData.writeBigUInt64LE(
  2_000_000n,
  dlmmActiveBinOffset + METEORA_DLMM_BIN_OFFSET_AMOUNT_X,
);
dlmmActiveBinArrayData.writeBigUInt64LE(
  2_000_000n,
  dlmmActiveBinOffset + METEORA_DLMM_BIN_OFFSET_AMOUNT_Y,
);
const dlmmGpaDataSizes: number[] = [];
const dlmmGetAccountInfoCalls: PublicKey[] = [];
const dlmmGmaRequests: PublicKey[][] = [];
const dlmmConnection = {
    async getSlot() {
      return 7;
    },
    async getProgramAccounts(programId: PublicKey, config: unknown) {
      assert.equal(programId.equals(METEORA_DLMM_PROGRAM_ID), true);
      const filters =
        typeof config === "object" && config != null && "filters" in config
          ? (config.filters as Array<
              { dataSize: number } | { memcmp: { offset: number; bytes: string } }
            >)
          : [];
      const dataSize = filters.find(
        (filter): filter is { dataSize: number } => "dataSize" in filter,
      )?.dataSize;
      if (typeof dataSize !== "number") throw new Error("MissingDataSizeFilter");
      dlmmGpaDataSizes.push(dataSize);
      if (dataSize === METEORA_DLMM_BIN_ARRAY_LEN) {
        throw new Error("UnexpectedMeteoraBinArrayGpaScan");
      }
      if (dataSize !== METEORA_DLMM_LB_PAIR_LEN) return [];
      const memcmpFilters = filters.filter(
        (filter): filter is { memcmp: { offset: number; bytes: string } } =>
          "memcmp" in filter,
      );
      if (
        memcmpFilters[0]?.memcmp.bytes !== dlmmBaseMint.toBase58() ||
        memcmpFilters[1]?.memcmp.bytes !== MIMIR_MAINNET_USDC_MINT.toBase58()
      ) {
        return [];
      }
      return [{
        pubkey: dlmmLbPair,
        account: accountInfo(dlmmPairData, METEORA_DLMM_PROGRAM_ID),
      }];
    },
    async getAccountInfo(pubkey: PublicKey) {
      dlmmGetAccountInfoCalls.push(pubkey);
      return pubkey.equals(dlmmActiveBinArray)
        ? accountInfo(dlmmActiveBinArrayData, METEORA_DLMM_PROGRAM_ID)
        : null;
    },
    async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
      dlmmGmaRequests.push([...pubkeys]);
      return pubkeys.map((pubkey) => {
        if (pubkey.equals(dlmmBaseVault)) {
          return accountInfo(
            tokenVaultData(dlmmBaseMint, dlmmVaultOwner, 3_000_000n),
            SPL_TOKEN_PROGRAM_ID,
          );
        }
        if (pubkey.equals(dlmmQuoteVault)) {
          return accountInfo(
            tokenVaultData(MIMIR_MAINNET_USDC_MINT, dlmmVaultOwner, 4_000_000n),
            SPL_TOKEN_PROGRAM_ID,
          );
        }
        return null;
      });
    },
} as unknown as Parameters<typeof createRpcMintOraclePoolDiscoveryProvider>[0]["connection"];
const dlmmProvider = createRpcMintOraclePoolDiscoveryProvider({
  connection: dlmmConnection,
});
const dlmmDiscovery = await discoverMintOraclePoolsForMint({
  discoveryProvider: dlmmProvider,
  mintAddress: dlmmBaseMint,
  quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
  cluster: "mainnet",
  families: ["meteora-dlmm"],
  minProductionSourceCount: 1,
});
assert.equal(dlmmDiscovery.allPools.length, 1);
assert.equal(
  new PublicKey(dlmmDiscovery.allPools[0]!.activeBinArray!).equals(dlmmActiveBinArray),
  true,
);
assert.deepEqual(dlmmGpaDataSizes, [METEORA_DLMM_LB_PAIR_LEN, METEORA_DLMM_LB_PAIR_LEN]);
assert.deepEqual(
  dlmmGetAccountInfoCalls.map((pubkey) => pubkey.toBase58()),
  [dlmmActiveBinArray.toBase58()],
);
// DLMM discovery also reads the mint pair to distinguish the classic V0 form
// from the metadata-only Token-2022 V1 form before accepting vault evidence.
assert.deepEqual(dlmmGmaRequests.map((request) => request.length), [2, 2]);

const mainnetDlmmPairData = Buffer.from(dlmmPairData);
MIMIR_MAINNET_USDC_MINT.toBuffer().copy(
  mainnetDlmmPairData,
  METEORA_DLMM_LB_PAIR_OFFSET_TOKEN_Y_MINT,
);
function mintData(decimals: number): Buffer {
  const data = Buffer.alloc(82);
  data.writeBigUInt64LE(1_000_000_000n, 36);
  data[44] = decimals;
  data[45] = 1;
  return data;
}
function metadataToken2022MintData(mint: PublicKey, decimals: number): Buffer {
  const data = Buffer.alloc(404);
  mintData(decimals).copy(data);
  data[165] = 1;
  const pointer = Buffer.alloc(64);
  mint.toBuffer().copy(pointer, 32);
  data.writeUInt16LE(18, 166);
  data.writeUInt16LE(pointer.length, 168);
  pointer.copy(data, 170);
  const metadata = Buffer.alloc(166);
  mint.toBuffer().copy(metadata, 32);
  let offset = 64;
  for (const value of ["Mimir metadata token", "MIMIR", "u".repeat(61)]) {
    const bytes = Buffer.from(value, "utf8");
    metadata.writeUInt32LE(bytes.length, offset);
    offset += 4;
    bytes.copy(metadata, offset);
    offset += bytes.length;
  }
  metadata.writeUInt32LE(0, offset);
  data.writeUInt16LE(19, 234);
  data.writeUInt16LE(metadata.length, 236);
  metadata.copy(data, 238);
  return data;
}
function token2022VaultData(mint: PublicKey, authority: PublicKey, amount: bigint): Buffer {
  const data = Buffer.alloc(170);
  tokenVaultData(mint, authority, amount).copy(data);
  data[165] = 2;
  data.writeUInt16LE(7, 166);
  data.writeUInt16LE(0, 168);
  return data;
}
const mainnetDlmmAccounts = new Map<string, AccountInfo<Buffer>>([
  [dlmmBaseMint.toBase58(), accountInfo(mintData(6), SPL_TOKEN_PROGRAM_ID)],
  [MIMIR_MAINNET_USDC_MINT.toBase58(), accountInfo(mintData(6), SPL_TOKEN_PROGRAM_ID)],
  [dlmmLbPair.toBase58(), accountInfo(mainnetDlmmPairData, METEORA_DLMM_PROGRAM_ID)],
  [
    dlmmBaseVault.toBase58(),
    accountInfo(tokenVaultData(dlmmBaseMint, dlmmVaultOwner, 3_000_000n), SPL_TOKEN_PROGRAM_ID),
  ],
  [
    dlmmQuoteVault.toBase58(),
    accountInfo(
      tokenVaultData(MIMIR_MAINNET_USDC_MINT, dlmmVaultOwner, 4_000_000n),
      SPL_TOKEN_PROGRAM_ID,
    ),
  ],
]);
const [mainnetVerifiedDlmm] = await verifyMintOraclePoolsWithRpc({
  connection: {
    async getSlot() {
      return 7;
    },
    async getAccountInfo(pubkey: PublicKey) {
      return pubkey.equals(dlmmActiveBinArray)
        ? accountInfo(dlmmActiveBinArrayData, METEORA_DLMM_PROGRAM_ID)
        : null;
    },
    async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
      return pubkeys.map((pubkey) => mainnetDlmmAccounts.get(pubkey.toBase58()) ?? null);
    },
  } as unknown as Parameters<typeof verifyMintOraclePoolsWithRpc>[0]["connection"],
  cluster: "mainnet",
  mintAddress: dlmmBaseMint,
  quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
  currentUnixTimestamp: 1,
  currentSlot: 7n,
  pools: [{
    family: "meteora-dlmm",
    poolOrMarket: dlmmLbPair,
    baseVault: dlmmBaseVault,
    quoteVault: dlmmQuoteVault,
    vaultAuthority: dlmmVaultOwner,
    baseDecimals: 6,
    quoteDecimals: 6,
  }],
});
assert.equal(mainnetVerifiedDlmm?.programId?.toString(), METEORA_DLMM_PROGRAM_ID.toString());
assert.ok((mainnetVerifiedDlmm?.minLiquidityNative ?? 0n) > 0n);
assert.ok((mainnetVerifiedDlmm?.minDepthTo50BpsNative ?? 0n) > 0n);

const dlmmV1Accounts = new Map(mainnetDlmmAccounts);
dlmmV1Accounts.set(dlmmBaseMint.toBase58(), accountInfo(
  metadataToken2022MintData(dlmmBaseMint, 6), SPL_TOKEN_2022_PROGRAM_ID,
));
dlmmV1Accounts.set(dlmmBaseVault.toBase58(), accountInfo(
  token2022VaultData(dlmmBaseMint, dlmmLbPair, 3_000_000n), SPL_TOKEN_2022_PROGRAM_ID,
));
dlmmV1Accounts.set(dlmmQuoteVault.toBase58(), accountInfo(
  tokenVaultData(MIMIR_MAINNET_USDC_MINT, dlmmLbPair, 4_000_000n), SPL_TOKEN_PROGRAM_ID,
));
const [mainnetVerifiedDlmmV1] = await verifyMintOraclePoolsWithRpc({
  connection: {
    async getSlot() { return 7; },
    async getAccountInfo(pubkey: PublicKey) {
      return pubkey.equals(dlmmActiveBinArray)
        ? accountInfo(dlmmActiveBinArrayData, METEORA_DLMM_PROGRAM_ID)
        : null;
    },
    async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
      return pubkeys.map((pubkey) => dlmmV1Accounts.get(pubkey.toBase58()) ?? null);
    },
  } as unknown as Parameters<typeof verifyMintOraclePoolsWithRpc>[0]["connection"],
  cluster: "mainnet",
  mintAddress: dlmmBaseMint,
  quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
  currentUnixTimestamp: 1,
  currentSlot: 7n,
  pools: [{
    family: "meteora-dlmm",
    poolOrMarket: dlmmLbPair,
    baseVault: dlmmBaseVault,
    quoteVault: dlmmQuoteVault,
    vaultAuthority: dlmmLbPair,
    baseDecimals: 6,
    quoteDecimals: 6,
    sourceIndex: 0,
  }],
});
assert.equal(mainnetVerifiedDlmmV1?.adapterVersion, 1);
assert.equal(mainnetVerifiedDlmmV1?.tokenProgram?.toString(), SPL_TOKEN_2022_PROGRAM_ID.toString());
assert.equal(new PublicKey(mainnetVerifiedDlmmV1?.token2022Mint!).toString(), dlmmBaseMint.toString());
const dlmmV1Source = buildMintOracleSourceConfigArgs({
  feedId: new Uint8Array(32).fill(76),
  baseMint: dlmmBaseMint,
  quoteMint: MIMIR_MAINNET_USDC_MINT,
  cluster: "mainnet",
  pools: [mainnetVerifiedDlmmV1!],
})[0]!;
assert.equal(dlmmV1Source.adapterVersion, 1);
assert.deepEqual(dlmmV1Source.tokenProgram, SPL_TOKEN_2022_PROGRAM_ID.toBuffer());

const ORCA_WHIRLPOOL_ACCOUNT_LEN = 653;
const ORCA_WHIRLPOOL_DISCRIMINATOR = Buffer.from([63, 149, 209, 12, 225, 128, 99, 9]);
const ORCA_WHIRLPOOL_OFFSET_CONFIG = 8;
const ORCA_WHIRLPOOL_OFFSET_LIQUIDITY = 49;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_A = 101;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_A = 133;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_B = 181;
const ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_B = 213;

function orcaFixture(
  whirlpoolsConfig: PublicKey,
  discriminator = ORCA_WHIRLPOOL_DISCRIMINATOR,
) {
  const baseMint = testPk(40);
  const pool = testPk(41);
  const baseVault = testPk(42);
  const quoteVault = testPk(43);
  const vaultAuthority = testPk(44);
  const poolData = Buffer.alloc(ORCA_WHIRLPOOL_ACCOUNT_LEN);
  discriminator.copy(poolData);
  whirlpoolsConfig.toBuffer().copy(poolData, ORCA_WHIRLPOOL_OFFSET_CONFIG);
  poolData.writeBigUInt64LE(1_000_000n, ORCA_WHIRLPOOL_OFFSET_LIQUIDITY);
  baseMint.toBuffer().copy(poolData, ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_A);
  baseVault.toBuffer().copy(poolData, ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_A);
  MIMIR_MAINNET_USDC_MINT.toBuffer().copy(
    poolData,
    ORCA_WHIRLPOOL_OFFSET_TOKEN_MINT_B,
  );
  quoteVault.toBuffer().copy(poolData, ORCA_WHIRLPOOL_OFFSET_TOKEN_VAULT_B);
  const accounts = new Map<string, AccountInfo<Buffer>>([
    [baseMint.toBase58(), accountInfo(mintData(6), SPL_TOKEN_PROGRAM_ID)],
    [MIMIR_MAINNET_USDC_MINT.toBase58(), accountInfo(mintData(6), SPL_TOKEN_PROGRAM_ID)],
    [pool.toBase58(), accountInfo(poolData, ORCA_WHIRLPOOL_PROGRAM_ID)],
    [
      baseVault.toBase58(),
      accountInfo(tokenVaultData(baseMint, vaultAuthority, 3_000_000n), SPL_TOKEN_PROGRAM_ID),
    ],
    [
      quoteVault.toBase58(),
      accountInfo(
        tokenVaultData(MIMIR_MAINNET_USDC_MINT, vaultAuthority, 4_000_000n),
        SPL_TOKEN_PROGRAM_ID,
      ),
    ],
  ]);
  const connection = {
    async getSlot() {
      return 7;
    },
    async getProgramAccounts(programId: PublicKey, config: unknown) {
      assert.equal(programId.equals(ORCA_WHIRLPOOL_PROGRAM_ID), true);
      const filters = (config as {
        filters: Array<{ dataSize: number } | { memcmp: { offset: number; bytes: string } }>;
      }).filters;
      const memcmp = filters.filter(
        (filter): filter is { memcmp: { offset: number; bytes: string } } => "memcmp" in filter,
      );
      return memcmp[0]?.memcmp.bytes === baseMint.toBase58() &&
          memcmp[1]?.memcmp.bytes === MIMIR_MAINNET_USDC_MINT.toBase58()
        ? [{ pubkey: pool, account: accounts.get(pool.toBase58())! }]
        : [];
    },
    async getAccountInfo(pubkey: PublicKey) {
      return accounts.get(pubkey.toBase58()) ?? null;
    },
    async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
      return pubkeys.map((pubkey) => accounts.get(pubkey.toBase58()) ?? null);
    },
  } as unknown as Parameters<typeof createRpcMintOraclePoolDiscoveryProvider>[0]["connection"];
  return {
    baseMint,
    connection,
    pool: {
      family: "orca-whirlpool" as const,
      poolOrMarket: pool,
      baseVault,
      quoteVault,
      vaultAuthority,
      whirlpoolsConfig,
      baseDecimals: 6,
      quoteDecimals: 6,
    },
  };
}

for (const cluster of ["mainnet", "localnet"] as const) {
  const canonical = orcaFixture(ORCA_WHIRLPOOLS_CONFIG_MAINNET);
  const discovery = await discoverMintOraclePoolsForMint({
    discoveryProvider: createRpcMintOraclePoolDiscoveryProvider({
      connection: canonical.connection,
    }),
    mintAddress: canonical.baseMint,
    quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
    cluster,
    families: ["orca-whirlpool"],
    minProductionSourceCount: 1,
  });
  assert.equal(discovery.allPools.length, 1);
  assert.equal((await verifyMintOraclePoolsWithRpc({
    connection: canonical.connection,
    mintAddress: canonical.baseMint,
    quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
    cluster,
    pools: [canonical.pool],
    currentUnixTimestamp: 1,
    currentSlot: 7n,
  })).length, 1);

  const alternate = orcaFixture(testPk(45));
  const rejectedDiscovery = await discoverMintOraclePoolsForMint({
    discoveryProvider: createRpcMintOraclePoolDiscoveryProvider({
      connection: alternate.connection,
    }),
    mintAddress: alternate.baseMint,
    quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
    cluster,
    families: ["orca-whirlpool"],
  });
  assert.equal(rejectedDiscovery.allPools.length, 0);
  await assert.rejects(
    verifyMintOraclePoolsWithRpc({
      connection: alternate.connection,
      mintAddress: alternate.baseMint,
      quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
      cluster,
      pools: [alternate.pool],
      currentUnixTimestamp: 1,
      currentSlot: 7n,
    }),
    /UnverifiedMintOraclePoolGraph/,
  );

  const mutatedDiscriminator = Buffer.from(ORCA_WHIRLPOOL_DISCRIMINATOR);
  mutatedDiscriminator[7] ^= 1;
  for (const discriminator of [Buffer.alloc(8), mutatedDiscriminator]) {
    const invalid = orcaFixture(ORCA_WHIRLPOOLS_CONFIG_MAINNET, discriminator);
    const rejectedByDiscriminator = await discoverMintOraclePoolsForMint({
      discoveryProvider: createRpcMintOraclePoolDiscoveryProvider({
        connection: invalid.connection,
      }),
      mintAddress: invalid.baseMint,
      quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
      cluster,
      families: ["orca-whirlpool"],
    });
    assert.equal(rejectedByDiscriminator.allPools.length, 0);
    await assert.rejects(
      verifyMintOraclePoolsWithRpc({
        connection: invalid.connection,
        mintAddress: invalid.baseMint,
        quoteMintAddress: MIMIR_MAINNET_USDC_MINT,
        cluster,
        pools: [invalid.pool],
        currentUnixTimestamp: 1,
        currentSlot: 7n,
      }),
      /UnverifiedMintOraclePoolGraph/,
    );
  }
}

const RAYDIUM_CLMM_POOL_STATE_LEN = 1_544;
const RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG = 9;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_0 = 73;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_1 = 105;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_0 = 137;
const RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_1 = 169;
const RAYDIUM_CLMM_POOL_OFFSET_TICK_SPACING = 235;
const RAYDIUM_CLMM_POOL_OFFSET_LIQUIDITY = 237;
const RAYDIUM_CLMM_POOL_OFFSET_SQRT_PRICE = 253;
const RAYDIUM_CLMM_POOL_OFFSET_CURRENT_TICK = 269;

function clmmMintData(decimals: number): Buffer {
  const data = mintData(decimals);
  return data;
}

function clmmRpcFixture(token2022Base: boolean) {
  const baseMint = testPk(token2022Base ? 70 : 72);
  const quoteMint = MIMIR_MAINNET_USDC_MINT;
  const pool = testPk(token2022Base ? 74 : 76);
  const baseVault = testPk(token2022Base ? 75 : 77);
  const quoteVault = testPk(token2022Base ? 78 : 79);
  const ammConfig = testPk(token2022Base ? 80 : 81);
  const lowerTickArray = testPk(token2022Base ? 82 : 83);
  const activeTickArray = testPk(token2022Base ? 84 : 85);
  const upperTickArray = testPk(token2022Base ? 86 : 87);
  const token2022Mint = token2022Base ? baseMint : quoteMint;
  const poolData = Buffer.alloc(RAYDIUM_CLMM_POOL_STATE_LEN);
  ammConfig.toBuffer().copy(poolData, RAYDIUM_CLMM_POOL_OFFSET_AMM_CONFIG);
  baseMint.toBuffer().copy(poolData, RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_0);
  quoteMint.toBuffer().copy(poolData, RAYDIUM_CLMM_POOL_OFFSET_TOKEN_MINT_1);
  baseVault.toBuffer().copy(poolData, RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_0);
  quoteVault.toBuffer().copy(poolData, RAYDIUM_CLMM_POOL_OFFSET_TOKEN_VAULT_1);
  poolData.writeUInt16LE(1, RAYDIUM_CLMM_POOL_OFFSET_TICK_SPACING);
  poolData.writeBigUInt64LE(1_000_000n, RAYDIUM_CLMM_POOL_OFFSET_LIQUIDITY);
  poolData.writeBigUInt64LE(1n, RAYDIUM_CLMM_POOL_OFFSET_SQRT_PRICE + 8);
  poolData.writeInt32LE(0, RAYDIUM_CLMM_POOL_OFFSET_CURRENT_TICK);
  const baseTokenProgram = token2022Base ? SPL_TOKEN_2022_PROGRAM_ID : SPL_TOKEN_PROGRAM_ID;
  const quoteTokenProgram = token2022Base ? SPL_TOKEN_PROGRAM_ID : SPL_TOKEN_2022_PROGRAM_ID;
  const accounts = new Map<string, AccountInfo<Buffer>>([
    [baseMint.toBase58(), accountInfo(clmmMintData(6), baseTokenProgram)],
    [quoteMint.toBase58(), accountInfo(clmmMintData(6), quoteTokenProgram)],
    [pool.toBase58(), accountInfo(poolData, RAYDIUM_CLMM_MAINNET_PROGRAM_ID)],
    [baseVault.toBase58(), accountInfo(tokenVaultData(baseMint, pool, 3_000_000n), baseTokenProgram)],
    [quoteVault.toBase58(), accountInfo(tokenVaultData(quoteMint, pool, 4_000_000n), quoteTokenProgram)],
  ]);
  const connection = {
    async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
      return pubkeys.map((pubkey) => accounts.get(pubkey.toBase58()) ?? null);
    },
  } as unknown as Parameters<typeof verifyMintOraclePoolsWithRpc>[0]["connection"];
  const poolInput = {
    family: "raydium-clmm" as const,
    poolOrMarket: pool,
    baseVault,
    quoteVault,
    programId: RAYDIUM_CLMM_MAINNET_PROGRAM_ID,
    ammConfig,
    vaultAuthority: pool,
    baseDecimals: 6,
    quoteDecimals: 6,
    adapterVersion: 1 as const,
    token2022Mint,
    lowerTickArray,
    activeTickArray,
    upperTickArray,
    sourceIndex: 0,
  };
  return { connection, baseMint, quoteMint, poolInput, token2022Mint, lowerTickArray, activeTickArray, upperTickArray };
}

for (const token2022Base of [true, false]) {
  const fixture = clmmRpcFixture(token2022Base);
  const verified = (await verifyMintOraclePoolsWithRpc({
    connection: fixture.connection,
    cluster: "mainnet",
    mintAddress: fixture.baseMint,
    quoteMintAddress: fixture.quoteMint,
    currentUnixTimestamp: 1,
    currentSlot: 7n,
    pools: [fixture.poolInput],
  }))[0]!;
  assert.equal(verified.adapterVersion, 1);
  assert.equal(verified.tokenProgram?.toString(), SPL_TOKEN_2022_PROGRAM_ID.toString());
  assert.equal(new PublicKey(verified.token2022Mint!).toString(), fixture.token2022Mint.toString());
  assert.equal(verified.lowerTickArray?.toString(), fixture.lowerTickArray.toString());
  assert.equal(verified.activeTickArray?.toString(), fixture.activeTickArray.toString());
  assert.equal(verified.upperTickArray?.toString(), fixture.upperTickArray.toString());
  const source = buildMintOracleSourceConfigArgs({
    feedId: new Uint8Array(32).fill(token2022Base ? 90 : 91),
    baseMint: fixture.baseMint,
    quoteMint: fixture.quoteMint,
    cluster: "mainnet",
    pools: [verified],
  })[0]!;
  assert.equal(source.adapterVersion, 1);
  assert.deepEqual(source.tokenProgram, SPL_TOKEN_2022_PROGRAM_ID.toBuffer());
  assert.deepEqual(source.baseVault, fixture.poolInput.baseVault.toBuffer());
  assert.deepEqual(source.quoteVault, fixture.poolInput.quoteVault.toBuffer());

  for (const mismatch of [
    { adapterVersion: 0 as const },
    { tokenProgram: SPL_TOKEN_PROGRAM_ID },
    { token2022Mint: testPk(99) },
  ]) {
    await assert.rejects(() => verifyMintOraclePoolsWithRpc({
      connection: fixture.connection,
      cluster: "mainnet",
      mintAddress: fixture.baseMint,
      quoteMintAddress: fixture.quoteMint,
      currentUnixTimestamp: 1,
      currentSlot: 7n,
      pools: [{ ...fixture.poolInput, ...mismatch }],
    }), /UnverifiedMintOraclePoolGraph/);
  }

  if (token2022Base) {
    const tickless = (await verifyMintOraclePoolsWithRpc({
      connection: fixture.connection,
      cluster: "mainnet",
      mintAddress: fixture.baseMint,
      quoteMintAddress: fixture.quoteMint,
      currentUnixTimestamp: 1,
      currentSlot: 7n,
      pools: [{ ...fixture.poolInput, lowerTickArray: undefined, activeTickArray: undefined, upperTickArray: undefined }],
    }))[0]!;
    assert.throws(() => buildMintOracleSourceConfigArgs({
      feedId: new Uint8Array(32).fill(92),
      baseMint: fixture.baseMint,
      quoteMint: fixture.quoteMint,
      cluster: "mainnet",
      pools: [tickless],
    }), /RaydiumClmmV1RequiresRouteableTickArrays/);
  }
}

{
  const real = PUMPSWAP_REAL_287_POOL;
  const baseMint = new PublicKey(real.data.subarray(43, 75));
  const quoteMint = new PublicKey(real.data.subarray(75, 107));
  const scannedSizes: number[] = [];
  const hydrated: string[] = [];
  const connection = {
    async getSlot() { return 7; },
    async getProgramAccounts(programId: PublicKey, config: unknown) {
      assert.equal(programId.equals(PUMPSWAP_PROGRAM_ID), true);
      const filters = (config as { filters: Array<{ dataSize?: number; memcmp?: { offset: number; bytes: string } }> }).filters;
      const dataSize = filters[0]!.dataSize!;
      scannedSizes.push(dataSize);
      assert.deepEqual(filters.slice(1).map((filter) => [filter.memcmp!.offset, filter.memcmp!.bytes]),
        [[43, baseMint.toBase58()], [75, quoteMint.toBase58()]]);
      return dataSize === real.data.length
        ? [{ pubkey: new PublicKey(real.address), account: { data: Buffer.from(real.data), owner: PUMPSWAP_PROGRAM_ID, executable: false, lamports: 2_888_400 } }]
        : [];
    },
    async getAccountInfo() { return null; },
    async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) {
      hydrated.push(...pubkeys.map((pubkey) => pubkey.toBase58()));
      return pubkeys.map(() => null);
    },
  } as unknown as Parameters<typeof createRpcMintOraclePoolDiscoveryProvider>[0]["connection"];
  await createRpcMintOraclePoolDiscoveryProvider({ connection }).discoverMintOraclePools({
    mintAddress: baseMint, quoteMintAddress: quoteMint, cluster: "mainnet", families: ["pumpswap"],
  } as never);
  assert.deepEqual(scannedSizes, [300, 301, 287], "PumpSwap scan queries every pool layout once, base-oriented");
  assert.deepEqual(hydrated, [
    new PublicKey(real.data.subarray(139, 171)).toBase58(),
    new PublicKey(real.data.subarray(171, 203)).toBase58(),
  ], "the real 287-byte migrate_v2 pool passes the scan filters");
}

{
  const { MINT_ORACLE_MARKET_FLAGS, evaluateMintOracleLongTailPools } = await import("../src/mintOracle.js");
  assert.throws(() => (MINT_ORACLE_MARKET_FLAGS as Record<string, number>).MANIPULATION_COST_LOW, /MintOracleRemovedName/);
  assert.ok(MINT_ORACLE_MARKET_FLAGS.FEE_LOSS_FLOOR_LOW > 0);
  assert.ok(!Object.keys(MINT_ORACLE_MARKET_FLAGS).includes("MANIPULATION_COST_LOW"));
  assert.throws(() => evaluateMintOracleLongTailPools({ pools: [], policy: { minManipulationCostFloorNative: 1n } as never }), /MintOracleRemovedName/);
}

{
  const jup = { mintAddress: new PublicKey("8XQaWEy8rZfCWpnZfBA6KRfdQUcCLuriZw6Ubmerhaib"), quoteMintAddress: new PublicKey("DRStb6fqmiX4zssMU1mEJEXRpoKcDDtsXuENAKeJ1wTQ") };
  assert.equal(deriveMintPairFeedIdHex({ ...jup, cluster: "devnet" }), "62fbca7a350b92d157d9e4ef981b0cc32c12935216360a2b83a2837295cbe277");
  assert.throws(() => deriveMintPairFeedIdHex({ ...jup, cluster: "mainnet" }));
  assert.equal(defaultProgramIdForSourceFamily("raydium-cpmm", "devnet").toBase58(), "DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb");
  assert.throws(() => deriveMintPairFeedIdHex({ ...jup, cluster: "testnet" as never }), /InvalidMintOracleCluster/);
}

{
  const { discoverMintOracleUsdQuotePoolsForMint } = await import("../src/mintOracle.js");
  const { MIMIR_BETA_CLUSTER_TABLES } = await import("../src/beta/cluster.js");
  const devnet = MIMIR_BETA_CLUSTER_TABLES.devnet;
  const queried = new Map<string, number[]>();
  const quotes = new Set<string>();
  const connection = {
    async getSlot() { return 7; },
    async getProgramAccounts(programId: PublicKey, config: unknown) {
      const filters = (config as { filters: Array<{ dataSize?: number; memcmp?: { offset: number; bytes: string } }> }).filters;
      queried.set(programId.toBase58(), [...(queried.get(programId.toBase58()) ?? []), filters[0]!.dataSize!]);
      for (const filter of filters.slice(1)) quotes.add(filter.memcmp!.bytes);
      return [];
    },
    async getAccountInfo() { return null; },
    async getMultipleAccountsInfo(pubkeys: readonly PublicKey[]) { return pubkeys.map(() => null); },
  } as unknown as Parameters<typeof createRpcMintOraclePoolDiscoveryProvider>[0]["connection"];
  const rpc = createRpcMintOraclePoolDiscoveryProvider({ connection });
  const families = ["orca-whirlpool", "meteora-dlmm", "meteora-damm-v2", "raydium-clmm", "raydium-cpmm", "pumpswap"] as const;
  const selection = await discoverMintOracleUsdQuotePoolsForMint({ cluster: "devnet", mintAddress: new PublicKey("8XQaWEy8rZfCWpnZfBA6KRfdQUcCLuriZw6Ubmerhaib"),
    discoveryProvider: { async discoverMintOraclePools(args: { quoteMintAddress: PublicKey; cluster: string }) {
      const scanned = await rpc.discoverMintOraclePools(args as never);
      assert.equal(args.cluster, "devnet");
      return scanned.length || !args.quoteMintAddress.equals(new PublicKey(devnet.usdStableQuoteMints.usdc)) ? scanned : [{ family: "raydium-clmm" as const,
        poolOrMarket: new PublicKey(new Uint8Array(32).fill(41)), baseVault: new PublicKey(new Uint8Array(32).fill(42)),
        quoteVault: new PublicKey(new Uint8Array(32).fill(43)), vaultAuthority: new PublicKey(new Uint8Array(32).fill(44)), tvlUsd: 1_000_000 }];
    } }, families: [...families], includeSolQuote: false } as never);
  assert.equal(selection.selected.quoteKind, "stable-usdc", "devnet default USD discovery succeeds");
  assert.equal(selection.selected.quoteMintAddress.toBase58(), devnet.usdStableQuoteMints.usdc);
  assert.deepEqual([...queried.keys()].sort(), [...new Set(families.map((f) => devnet.venuePrograms[f]!))].sort(), "every scanned program is the devnet venue");
  assert.ok(!queried.has("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"));
  assert.deepEqual(queried.get(devnet.venuePrograms["raydium-cpmm"]!)!.every((size) => size === devnet.raydiumCpmmPoolStateLength), true);
  assert.ok(quotes.has(devnet.usdStableQuoteMints.usdc), "default USD quote is the devnet USDC");
  assert.ok(!quotes.has("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v") && !quotes.has("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"));
  const { MIMIR_MAINNET_USDC_MINT, MIMIR_MAINNET_USDT_MINT, ORCA_WHIRLPOOLS_CONFIG_MAINNET } = await import("../src/constants.js");
  const mainnet = MIMIR_BETA_CLUSTER_TABLES["mainnet-beta"];
  assert.deepEqual([mainnet.usdStableQuoteMints.usdc, mainnet.usdStableQuoteMints.usdt, mainnet.orcaWhirlpoolsConfig],
    [MIMIR_MAINNET_USDC_MINT, MIMIR_MAINNET_USDT_MINT, ORCA_WHIRLPOOLS_CONFIG_MAINNET].map((k) => k.toBase58()), "mainnet profile matches canonical constants");
}

{
  const programId = defaultProgramIdForSourceFamily("meteora-damm-v2", "devnet");
  const baseMint = testPk(120); const quoteMint = testPk(121);
  const cases = [[0, 100n, true], [0, 101n, false], [1, 1_000n, true], [1, 1_001n, false], [2, 0n, false]] as const;
  const pools = cases.map(([type, point], index) => {
    const data = Buffer.alloc(1112);
    baseMint.toBuffer().copy(data, 168); quoteMint.toBuffer().copy(data, 200);
    testPk(130 + index).toBuffer().copy(data, 232); testPk(140 + index).toBuffer().copy(data, 264);
    data.writeBigUInt64LE(point, 472); data[480] = type;
    return { pubkey: testPk(150 + index), account: { data, owner: programId, lamports: 1, executable: false } };
  });
  const requested = new Set<string>();
  const connection = {
    async getSlot() { return 100; },
    async getProgramAccounts(owner: PublicKey, config: { filters: Array<{ memcmp?: { offset: number; bytes: string } }> }) {
      return owner.equals(programId) && config.filters[1]!.memcmp!.bytes === baseMint.toBase58() ? pools : [];
    },
    async getAccountInfo() { return null; },
    async getMultipleAccountsInfo(keys: readonly PublicKey[]) { for (const key of keys) requested.add(key.toBase58()); return keys.map(() => null); },
  } as unknown as Parameters<typeof createRpcMintOraclePoolDiscoveryProvider>[0]["connection"];
  await createRpcMintOraclePoolDiscoveryProvider({ connection, currentSlot: 100n, currentUnixTimestamp: 1_000 })
    .discoverMintOraclePools({ cluster: "devnet", mintAddress: baseMint, quoteMintAddress: quoteMint, families: ["meteora-damm-v2"] } as never);
  assert.deepEqual(cases.map((_, index) => requested.has(testPk(130 + index).toBase58())), cases.map(([, , open]) => open), "DAMM v2 activation uses byte 480 with slot/timestamp modes and rejects unknown modes");
}

process.stdout.write("mintOracle tests passed\n");
