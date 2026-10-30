import { address, type Address } from "@solana/kit";
import type { MimirBetaCluster } from "./deployment.js";
import type { MimirBetaSourceFamily } from "./types.js";

export interface MimirBetaClusterTable {
  readonly venuePrograms: Readonly<Record<MimirBetaSourceFamily, Address | null>>;
  readonly orcaWhirlpoolsConfig: Address;
  readonly raydiumCpmmPoolStateLength: number;
  readonly twapMinCoverageBps: number;
  readonly quoteMints: readonly Address[] | null;
  readonly classicQuoteMints: readonly Address[] | null;
  readonly collateralMint: Address | null;
  readonly ammV4MarketPrograms: readonly Address[];
  readonly ammV4AdministrativeOwner: Address;
  readonly usdStableQuoteMints: Readonly<{ usdc: Address; usdt: Address | null; legacyUsdc: Address | null }>;
}

const SOL_MINT = address("So11111111111111111111111111111111111111112");

const MAINNET: MimirBetaClusterTable = Object.freeze({
  venuePrograms: Object.freeze({
    "orca-whirlpool": address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
    "meteora-dlmm": address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"),
    "meteora-damm-v2": address("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
    "raydium-clmm": address("CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK"),
    "raydium-cpmm": address("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
    "raydium-amm-v4": address("675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8"),
    "pumpswap": address("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
  }),
  orcaWhirlpoolsConfig: address("2LecshUwdy9xi7meFgHtFJQNSKk4KdTrcpvaB56dP2NQ"),
  raydiumCpmmPoolStateLength: 637,
  twapMinCoverageBps: 9_000,
  quoteMints: null,
  classicQuoteMints: null,
  collateralMint: null,
  ammV4MarketPrograms: Object.freeze([address("9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin"), address("srmqPvymJeFKQ4zGQed1GFppgkRHL9kaELCbyksJtPX")]),
  ammV4AdministrativeOwner: address("GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ"),
  usdStableQuoteMints: Object.freeze({ usdc: address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
    usdt: address("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"), legacyUsdc: null }),
});

const DEVNET: MimirBetaClusterTable = Object.freeze({
  venuePrograms: Object.freeze({
    "orca-whirlpool": address("whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc"),
    "meteora-dlmm": address("LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo"),
    "meteora-damm-v2": address("cpamdpZCGKUy5JxQXB4dcpGPiikHawvSWAd6mEn1sGG"),
    "raydium-clmm": address("DRayAUgENGQBKVaX8owNhgzkEDyoHTGVEGHVJT1E9pfH"),
    "raydium-cpmm": address("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
    "raydium-amm-v4": address("DRaya7Kj3aMWQSy19kSjvmuwq9docCHofyP9kanQGaav"),
    "pumpswap": address("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"),
  }),
  orcaWhirlpoolsConfig: address("FcrweFY1G9HJAHG5inkGB6pKg1HZ6x9UC2WioAfWrGkR"),
  raydiumCpmmPoolStateLength: 637,
  twapMinCoverageBps: 9_000,
  quoteMints: Object.freeze([SOL_MINT, address("DRStb6fqmiX4zssMU1mEJEXRpoKcDDtsXuENAKeJ1wTQ"),
    address("5W1Mg5LYmczXTGAqjSoTeMi7tXUQx3bfXsLr1MKvV1Tk")]),
  classicQuoteMints: Object.freeze([address("DRStb6fqmiX4zssMU1mEJEXRpoKcDDtsXuENAKeJ1wTQ"),
    address("5W1Mg5LYmczXTGAqjSoTeMi7tXUQx3bfXsLr1MKvV1Tk")]),
  collateralMint: address("ADb8dPPZK2LU3BVyuEfwGbQ1FujEAtRDxdhaTreLV9ij"),
  ammV4MarketPrograms: Object.freeze([address("DESVgJVGajEgKGXhb6XmqDHGz3VjdgP7rEVESBgxmroY"), address("EoTcMgcDRTJVZDMZWBoU6rhYHZfkNTVEAfz3uUJRcYGj")]),
  ammV4AdministrativeOwner: address("DRayqG9RXYi8WHgWEmRQGrUWRWbhjYWYkCRJDd6JBBak"),
  usdStableQuoteMints: Object.freeze({ usdc: address("DRStb6fqmiX4zssMU1mEJEXRpoKcDDtsXuENAKeJ1wTQ"), usdt: null,
    legacyUsdc: address("5W1Mg5LYmczXTGAqjSoTeMi7tXUQx3bfXsLr1MKvV1Tk") }),
});

export const MIMIR_BETA_CLUSTER_TABLES: Readonly<Record<MimirBetaCluster, MimirBetaClusterTable>> = Object.freeze({
  "localnet": MAINNET,
  "mainnet-beta": MAINNET,
  "devnet": DEVNET,
});

export const MIMIR_BETA_DEVNET_CUSDC_V2 = address("DRStb6fqmiX4zssMU1mEJEXRpoKcDDtsXuENAKeJ1wTQ");

export function mimirBetaClusterTable(cluster: MimirBetaCluster): MimirBetaClusterTable {
  const table = Object.hasOwn(MIMIR_BETA_CLUSTER_TABLES, cluster) ? MIMIR_BETA_CLUSTER_TABLES[cluster] : undefined;
  if (!table) throw new Error("unsupported beta cluster");
  return table;
}

export function mimirBetaVenueProgram(cluster: MimirBetaCluster, family: MimirBetaSourceFamily): Address | null {
  return mimirBetaClusterTable(cluster).venuePrograms[family];
}
