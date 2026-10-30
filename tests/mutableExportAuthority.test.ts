import assert from "node:assert/strict";
import {
  PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  type AccountInfo,
} from "@solana/web3.js";
import * as constants from "../src/constants.js";
import { SourceDirection } from "../src/sourceDirection.js";
import {
  MINT_ORACLE_ADAPTER_SEPARATE_SOURCE_FAMILIES,
  MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES,
  MINT_ORACLE_MARKET_FLAGS,
  MINT_ORACLE_PRODUCTION_PRIORITY_SOURCE_FAMILIES,
  MINT_ORACLE_SOURCE_FAMILY_ORDER,
  createRpcMintOraclePoolDiscoveryProvider,
  defaultProgramIdForSourceFamily,
  discoverMintOraclePoolsForMint,
  resolveMintOracleAccounts,
  sourcePriorityForFamily,
  verifyMintOraclePoolsWithRpc,
} from "../src/mintOracle.js";
import { findFeedConfigPda } from "../src/pda.js";
import { MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1 } from "../src/creationExecutionInventoryEnvelope.js";
import { MIMIR_BETA_TRANSACTION_V1_CONFIG } from "../src/beta/transactionV1.js";

const MIMIR = constants.MIMIR_MAINNET_PROGRAM_ID.toBase58();
const SYSTEM = "11111111111111111111111111111111";
const SPL_TOKEN = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const ORCA = "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc";
const ORCA_CONFIG = "2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ";
const PUMPSWAP = "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA";
const ORCA_DISCRIMINATOR = Buffer.from([63, 149, 209, 12, 225, 128, 99, 9]);

function key(byte: number): PublicKey {
  return new PublicKey(Buffer.alloc(32, byte));
}

function accountInfo(data: Buffer, owner: PublicKey): AccountInfo<Buffer> {
  return { data, executable: false, lamports: 1, owner, rentEpoch: 0 };
}

function mintData(decimals: number): Buffer {
  const data = Buffer.alloc(82);
  data[44] = decimals;
  data[45] = 1;
  return data;
}

function tokenVaultData(mint: PublicKey, owner: PublicKey): Buffer {
  const data = Buffer.alloc(165);
  mint.toBuffer().copy(data, 0);
  owner.toBuffer().copy(data, 32);
  data.writeBigUInt64LE(4_000_000n, 64);
  data[108] = 1;
  return data;
}

const canonicalMimir = new PublicKey(MIMIR);
const canonicalUsdc = new PublicKey(USDC);
const canonicalOrca = new PublicKey(ORCA);
const canonicalOrcaConfig = new PublicKey(ORCA_CONFIG);
const canonicalSplToken = new PublicKey(SPL_TOKEN);
const attacker = key(250);
const feedId = Buffer.alloc(32, 9);
const expectedFeedConfig = PublicKey.findProgramAddressSync(
  [Buffer.from("feed_config"), feedId],
  canonicalMimir,
)[0];


assert.equal(constants.MIMIR_PROGRAM_ID, constants.MIMIR_MAINNET_PROGRAM_ID);
assert.equal(
  constants.MIMIR_LOCALNET_ADMITTED_POOL_QUOTE_MINTS,
  constants.MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS,
);
assert.equal(
  constants.MIMIR_MAINNET_ADMITTED_QUOTE_MINTS,
  constants.MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS,
);
assert.equal(constants.PUMPSWAP_FEE_PROGRAM_ID, constants.PUMP_FEE_PROGRAM_ID);
assert.equal(
  constants.RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR,
  constants.RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
);

type MutableKey = PublicKey & { _bn: unknown };
const keyRestores = new Map<PublicKey, unknown>();
const bufferRestores = new Map<Buffer, Buffer>();
const arrayRestores = new Map<unknown[], unknown[]>();
const recordRestores = new Map<object, PropertyDescriptorMap>();

function poisonKey(value: PublicKey): void {
  if (keyRestores.has(value)) return;
  const mutable = value as MutableKey;
  keyRestores.set(value, mutable._bn);
  mutable._bn = (attacker as MutableKey)._bn;
}

function poisonBuffer(value: Buffer): void {
  if (bufferRestores.has(value)) return;
  bufferRestores.set(value, Buffer.from(value));
  value.fill(0xa5);
}

function poisonArray(value: readonly unknown[], replacement: unknown): void {
  const mutable = value as unknown[];
  if (!arrayRestores.has(mutable)) arrayRestores.set(mutable, [...mutable]);
  for (const entry of mutable) if (entry instanceof PublicKey) poisonKey(entry);
  mutable.splice(0, mutable.length, replacement);
}

function poisonRecord(value: object): void {
  if (recordRestores.has(value)) return;
  recordRestores.set(value, Object.getOwnPropertyDescriptors(value));
  for (const [name, entry] of Object.entries(value)) {
    if (typeof entry === "number") Reflect.set(value, name, entry ^ 0x5a);
  }
  Reflect.set(value, "attacker", 255);
}

function restoreAll(): void {
  for (const [record, descriptors] of recordRestores) {
    for (const name of Reflect.ownKeys(record)) Reflect.deleteProperty(record, name);
    Object.defineProperties(record, descriptors);
  }
  for (const [array, saved] of arrayRestores) array.splice(0, array.length, ...saved);
  for (const [buffer, saved] of bufferRestores) saved.copy(buffer);
  for (const [publicKey, saved] of keyRestores) (publicKey as MutableKey)._bn = saved;
}

const publicKeys = [
  constants.MIMIR_MAINNET_PROGRAM_ID,
  constants.MIMIR_PROGRAM_ID,
  constants.SPL_TOKEN_PROGRAM_ID,
  constants.SPL_NATIVE_MINT_ID,
  constants.SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  constants.SPL_TOKEN_2022_PROGRAM_ID,
  constants.MIMIR_SOL_MINT,
  constants.MIMIR_MAINNET_USDC_MINT,
  constants.MIMIR_MAINNET_USDT_MINT,
  constants.MIMIR_MAINNET_COLA_MINT,
  constants.RAYDIUM_CPMM_MAINNET_PROGRAM_ID,
  constants.RAYDIUM_CLMM_MAINNET_PROGRAM_ID,
  constants.RAYDIUM_AMM_V4_PROGRAM_ID,
  constants.ORCA_WHIRLPOOL_PROGRAM_ID,
  constants.ORCA_WHIRLPOOLS_CONFIG_MAINNET,
  constants.METEORA_DLMM_PROGRAM_ID,
  constants.METEORA_DAMM_V2_PROGRAM_ID,
  constants.PUMPSWAP_PROGRAM_ID,
  constants.PUMP_PROGRAM_ID,
  constants.PUMP_FEE_PROGRAM_ID,
  constants.PUMPSWAP_FEE_PROGRAM_ID,
  constants.PUMPSWAP_GLOBAL_CONFIG,
  constants.PUMPSWAP_FEE_CONFIG,
  SystemProgram.programId,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
  PublicKey.default,
];

const policyArrays = [
  constants.MIMIR_MAINNET_ADMITTED_POOL_QUOTE_MINTS,
  constants.MIMIR_LOCALNET_ADMITTED_POOL_QUOTE_MINTS,
  constants.MIMIR_MAINNET_CLASSIC_FEED_QUOTE_MINTS,
  constants.MIMIR_LOCALNET_CLASSIC_FEED_QUOTE_MINTS,
  constants.MIMIR_MAINNET_ADMITTED_QUOTE_MINTS,
  constants.MIMIR_LOCALNET_ADMITTED_QUOTE_MINTS,
  constants.MIMIR_STABLECOIN_AUTHORITY_BYPASS_MINTS,
  constants.MIMIR_OPERATOR_CONTROLLED_AUTHORITY_MINTS,
];

const stringArrays = [
  MINT_ORACLE_PRODUCTION_PRIORITY_SOURCE_FAMILIES,
  MINT_ORACLE_ADAPTER_SEPARATE_SOURCE_FAMILIES,
  MINT_ORACLE_DEFAULT_DISCOVERY_SOURCE_FAMILIES,
  MINT_ORACLE_SOURCE_FAMILY_ORDER,
];

const authorityBuffers = [
  constants.RAYDIUM_CPMM_POOL_STATE_DISCRIMINATOR,
  constants.RAYDIUM_CLMM_POOL_STATE_DISCRIMINATOR,
  constants.RAYDIUM_CPMM_OBSERVATION_STATE_DISCRIMINATOR,
  constants.RAYDIUM_CPMM_OBSERVATION_SEED,
  constants.FEED_SNAPSHOT_MAGIC,
  constants.FEED_CONFIG_MAGIC,
  constants.FEED_RESERVATION_MAGIC,
  constants.ORACLE_REGISTRY_MAGIC,
  constants.SOURCING_PLAN_MAGIC,
  constants.SOURCE_CONFIG_MAGIC,
  constants.FEED_TWAP_MAGIC,
  constants.SOURCE_RING_MAGIC,
  constants.NATIVE_TWAP_PROOF_MAGIC,
  constants.GOVERNANCE_POLICY_MAGIC,
  constants.GOVERNANCE_ACTION_MAGIC,
  constants.ADMIN_CONFIG_MAGIC,
  constants.FEED_COLLATERAL_LOCK_MAGIC,
  constants.FEED_FEE_VAULT_MAGIC,
  constants.COMPOSITE_FEED_CONFIG_MAGIC,
  constants.COMPOSITE_SNAPSHOT_MAGIC,
  constants.CAP_MODEL_HASH_V2,
];

const authorityRecords = [
  constants.OFFSETS,
  constants.CONFIG_OFFSETS,
  constants.REGISTRY_OFFSETS,
  constants.RESERVATION_OFFSETS,
  constants.PLAN_OFFSETS,
  constants.SOURCE_OFFSETS,
  constants.TWAP_OFFSETS,
  constants.RING_OFFSETS,
  constants.SOURCE_CAP_ENTRY_OFFSETS,
  constants.GOVERNANCE_POLICY_OFFSETS,
  constants.GOVERNANCE_ACTION_OFFSETS,
  constants.ADMIN_CONFIG_OFFSETS,
  constants.FEED_COLLATERAL_LOCK_OFFSETS,
  constants.FEED_FEE_VAULT_OFFSETS,
  constants.COMPOSITE_CONFIG_OFFSETS,
  constants.COMPOSITE_COMPONENT_OFFSETS,
  constants.COMPOSITE_SNAPSHOT_OFFSETS,
  constants.COMPOSITE_SNAPSHOT_COMPONENT_OFFSETS,
  constants.SnapshotStatus,
  constants.RouteabilityStatus,
  constants.RiskTier,
  constants.SnapshotSource,
  constants.FreshnessProfile,
  constants.PlanProfile,
  constants.QuoteStatus,
  constants.AnchorProvider,
  constants.AnchorStatus,
  constants.FeedLifecycleState,
  constants.RegistryStatus,
  constants.PlanStatus,
  constants.SourceAdapterType,
  constants.SourceStatus,
  constants.TwapStatus,
  constants.ObservationKind,
  constants.FeedReservationStatus,
  constants.FeedCollateralLockStatus,
  constants.FeedFeeVaultStatus,
  constants.AdminConfigStatus,
  constants.GovernancePolicyStatus,
  constants.GovernanceActionStatus,
  constants.GovernanceActionTargetKind,
  constants.VerifyFlags,
  SourceDirection,
  MINT_ORACLE_MARKET_FLAGS,
];


const firstProfile = constants.resolveMimirProgramProfile();
poisonKey(firstProfile.programId);
assert.equal(constants.resolveMimirProgramProfile().programId.toBase58(), MIMIR);
const firstPda = findFeedConfigPda(feedId)[0];
poisonKey(firstPda);
assert.equal(findFeedConfigPda(feedId)[0].toBase58(), expectedFeedConfig.toBase58());

function orcaFixture(options: {
  config?: PublicKey;
  discriminator?: Buffer;
  poolOwner?: PublicKey;
  vaultOwner?: PublicKey;
} = {}) {
  const baseMint = key(60);
  const pool = key(61);
  const baseVault = key(62);
  const quoteVault = key(63);
  const vaultAuthority = key(64);
  const poolData = Buffer.alloc(653);
  (options.discriminator ?? ORCA_DISCRIMINATOR).copy(poolData);
  (options.config ?? canonicalOrcaConfig).toBuffer().copy(poolData, 8);
  poolData.writeBigUInt64LE(1_000_000n, 49);
  baseMint.toBuffer().copy(poolData, 101);
  baseVault.toBuffer().copy(poolData, 133);
  canonicalUsdc.toBuffer().copy(poolData, 181);
  quoteVault.toBuffer().copy(poolData, 213);
  const accounts = new Map<string, AccountInfo<Buffer>>([
    [baseMint.toBase58(), accountInfo(mintData(6), canonicalSplToken)],
    [canonicalUsdc.toBase58(), accountInfo(mintData(6), canonicalSplToken)],
    [pool.toBase58(), accountInfo(poolData, options.poolOwner ?? canonicalOrca)],
    [baseVault.toBase58(), accountInfo(tokenVaultData(baseMint, vaultAuthority), options.vaultOwner ?? canonicalSplToken)],
    [quoteVault.toBase58(), accountInfo(tokenVaultData(canonicalUsdc, vaultAuthority), canonicalSplToken)],
  ]);
  let programScans = 0;
  const connection = {
    async getSlot() { return 7; },
    async getProgramAccounts(programId: PublicKey, config: unknown) {
      programScans += 1;
      assert.equal(programId.toBase58(), ORCA);
      const filters = (config as { filters: Array<{ memcmp?: { bytes: string } }> }).filters;
      const memcmp = filters.filter((filter) => filter.memcmp != null);
      return memcmp[0]?.memcmp?.bytes === baseMint.toBase58() &&
          memcmp[1]?.memcmp?.bytes === canonicalUsdc.toBase58()
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
    scans: () => programScans,
    pool: {
      family: "orca-whirlpool" as const,
      poolOrMarket: pool,
      baseVault,
      quoteVault,
      vaultAuthority,
      whirlpoolsConfig: options.config ?? canonicalOrcaConfig,
      baseDecimals: 6,
      quoteDecimals: 6,
    },
  };
}

try {
  for (const value of publicKeys) poisonKey(value);
  for (const value of policyArrays) poisonArray(value, attacker);
  for (const value of stringArrays) poisonArray(value, "attacker");
  for (const value of authorityBuffers) poisonBuffer(value);
  for (const value of authorityRecords) poisonRecord(value);

  assert.equal(constants.resolveMimirProgramProfile().programId.toBase58(), MIMIR);
  assert.equal(findFeedConfigPda(feedId)[0].toBase58(), expectedFeedConfig.toBase58());
  assert.equal(constants.isMimirAdmittedPoolQuoteMint(canonicalUsdc, "mainnet"), true);
  assert.equal(constants.isMimirAdmittedPoolQuoteMint(canonicalUsdc, "localnet"), true);
  assert.equal(constants.isMimirAdmittedPoolQuoteMint(attacker, "mainnet"), false);
  assert.equal(sourcePriorityForFamily("raydium-clmm"), "production-priority");

  const expectedPrograms = new Map([
    ["orca-whirlpool", ORCA],
    ["raydium-clmm", "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"],
    ["raydium-cpmm", "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"],
    ["meteora-dlmm", "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"],
    ["meteora-damm-v2", "cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"],
    ["pumpswap", PUMPSWAP],
  ] as const);
  for (const cluster of ["mainnet", "localnet"] as const) {
    for (const [family, expected] of expectedPrograms) {
      const first = defaultProgramIdForSourceFamily(family, cluster);
      assert.equal(first.toBase58(), expected);
      poisonKey(first);
      assert.equal(defaultProgramIdForSourceFamily(family, cluster).toBase58(), expected);
    }
  }


  const resolvedA = resolveMintOracleAccounts({
    mintAddress: key(70), quoteMintAddress: canonicalUsdc, cluster: "mainnet",
    sourceIndices: [0],
  });
  poisonKey(resolvedA.programId);
  poisonKey(resolvedA.baseMint);
  poisonKey(resolvedA.sourceAccounts[0]!.sourceConfig);
  (resolvedA.sourceAccounts as unknown[]).splice(0, resolvedA.sourceAccounts.length);
  const resolvedB = resolveMintOracleAccounts({
    mintAddress: key(70), quoteMintAddress: canonicalUsdc, cluster: "mainnet",
    sourceIndices: [0],
  });
  assert.equal(resolvedB.programId.toBase58(), MIMIR);
  assert.equal(resolvedB.baseMint.toBase58(), key(70).toBase58());
  assert.equal(resolvedB.sourceAccounts.length, 1);

  const familyCalls: string[][] = [];
  const mutatingProvider = {
    async discoverMintOraclePools(args: { families: readonly string[] }) {
      familyCalls.push([...args.families]);
      (args.families as string[]).splice(0, args.families.length, "attacker");
      return [];
    },
  };
  for (let index = 0; index < 2; index += 1) {
    await discoverMintOraclePoolsForMint({
      discoveryProvider: mutatingProvider as never,
      mintAddress: key(71),
      quoteMintAddress: canonicalUsdc,
      cluster: "mainnet",
    });
  }
  assert.deepEqual(familyCalls[0], familyCalls[1]);
  assert.equal(familyCalls[1]![0], "raydium-clmm");

  for (const cluster of ["mainnet", "localnet"] as const) {
    const canonical = orcaFixture();
    const discovered = await discoverMintOraclePoolsForMint({
      discoveryProvider: createRpcMintOraclePoolDiscoveryProvider({ connection: canonical.connection }),
      mintAddress: canonical.baseMint,
      quoteMintAddress: canonicalUsdc,
      cluster,
      families: ["orca-whirlpool"],
      minProductionSourceCount: 1,
    });
    assert.equal(discovered.allPools.length, 1);
    assert.equal((await verifyMintOraclePoolsWithRpc({
      connection: canonical.connection,
      mintAddress: canonical.baseMint,
      quoteMintAddress: canonicalUsdc,
      cluster,
      pools: [canonical.pool],
      currentUnixTimestamp: 1,
      currentSlot: 7n,
    })).length, 1);
    const firstPoolProgram = discovered.allPools[0]!.programId as PublicKey;
    poisonKey(firstPoolProgram);
    const rediscovered = await discoverMintOraclePoolsForMint({
      discoveryProvider: createRpcMintOraclePoolDiscoveryProvider({ connection: canonical.connection }),
      mintAddress: canonical.baseMint,
      quoteMintAddress: canonicalUsdc,
      cluster,
      families: ["orca-whirlpool"],
      minProductionSourceCount: 1,
    });
    assert.equal((rediscovered.allPools[0]!.programId as PublicKey).toBase58(), ORCA);

    for (const invalid of [
      orcaFixture({ config: attacker }),
      orcaFixture({ poolOwner: attacker }),
      orcaFixture({ vaultOwner: attacker }),
      orcaFixture({ discriminator: Buffer.alloc(8) }),
    ]) {
      const rejected = await discoverMintOraclePoolsForMint({
        discoveryProvider: createRpcMintOraclePoolDiscoveryProvider({ connection: invalid.connection }),
        mintAddress: invalid.baseMint,
        quoteMintAddress: canonicalUsdc,
        cluster,
        families: ["orca-whirlpool"],
      });
      assert.equal(rejected.allPools.length, 0);
      await assert.rejects(verifyMintOraclePoolsWithRpc({
        connection: invalid.connection,
        mintAddress: invalid.baseMint,
        quoteMintAddress: canonicalUsdc,
        cluster,
        pools: [invalid.pool],
        currentUnixTimestamp: 1,
        currentSlot: 7n,
      }), /UnverifiedMintOraclePoolGraph/);
    }

    let providerCalls = 0;
    await assert.rejects(discoverMintOraclePoolsForMint({
      discoveryProvider: {
        async discoverMintOraclePools() { providerCalls += 1; return []; },
      },
      mintAddress: canonical.baseMint,
      quoteMintAddress: attacker,
      cluster,
    }), /UnsupportedMintOracleQuoteMint/);
    assert.equal(providerCalls, 0);
  }

  assert.equal(Reflect.set(constants.KNOWN_SOURCE_ADAPTER_TYPES, "0", 99), false);
  assert.equal(constants.KNOWN_SOURCE_ADAPTER_TYPES[0], 0);
  assert.equal(Reflect.set(constants.SUPPORTED_SOURCE_ADAPTER_TYPES_V0, "0", 99), false);
  assert.equal(constants.SUPPORTED_SOURCE_ADAPTER_TYPES_V0[0], 0);
  assert.equal(Reflect.set(MIMIR_BETA_TRANSACTION_V1_CONFIG, "maxInstructions", 99), false);
  const envelopeAdapterVersion = MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1.adapterVersion;
  assert.equal(Reflect.set(MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1, "adapterVersion", 99), false);
  assert.equal(MIMIR_CREATION_EXECUTION_INVENTORY_ENVELOPE_V1.adapterVersion, envelopeAdapterVersion);
} finally {
  restoreAll();
}

assert.equal(constants.MIMIR_PROGRAM_ID.toBase58(), MIMIR);
assert.equal(constants.SPL_TOKEN_PROGRAM_ID.toBase58(), SPL_TOKEN);
assert.equal(SystemProgram.programId.toBase58(), SYSTEM);
process.stdout.write("mutable export authority tests passed\n");
