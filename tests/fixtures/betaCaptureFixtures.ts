import { getProgramDerivedAddress, type Address } from "@solana/kit";
import {
  MIMIR_BETA_SPL_TOKEN_PROGRAM_ID,
  MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET,
  deriveMimirBetaCaptureReadPlan,
  mimirBetaCapturePoolCoreLayout,
  mimirBetaCaptureScanDescriptors,
  type MimirBetaCapturedAccount,
  type MimirBetaCaptureReadNodeRole,
  type MimirBetaCaptureCandidateInput,
} from "../../src/beta/capture.js";
import { addressBytes, bytesAddress, utf8 } from "../../src/beta/bytes.js";
import { meteoraDlmmPriceFromIdX64 } from "../../src/math.js";
import type { MimirBetaPoolCreationBinding } from "../../src/beta/discovery.js";
import type { MimirBetaAdapterType, MimirBetaSourceFamily } from "../../src/beta/types.js";

const Q64 = 1n << 64n;
const POOL_DISCRIMINATOR = Uint8Array.of(247, 237, 227, 245, 215, 195, 222, 70);
const AMM_CONFIG_DISCRIMINATOR = Uint8Array.of(218, 244, 33, 104, 203, 203, 43, 111);

export const fixtureAddress = (seed: number): Address => bytesAddress(
  Uint8Array.from({ length: 32 }, (_, index) => ((seed + index * 17) % 254) + 1),
);

function putKey(data: Uint8Array, offset: number, value: Address): void { data.set(addressBytes(value), offset); }
function putU16(data: Uint8Array, offset: number, value: number): void { new DataView(data.buffer).setUint16(offset, value, true); }
function putI32(data: Uint8Array, offset: number, value: number): void { new DataView(data.buffer).setInt32(offset, value, true); }
function putU64(data: Uint8Array, offset: number, value: bigint): void { new DataView(data.buffer).setBigUint64(offset, value, true); }
function putI64(data: Uint8Array, offset: number, value: bigint): void { new DataView(data.buffer).setBigInt64(offset, value, true); }
function putU128(data: Uint8Array, offset: number, value: bigint): void {
  putU64(data, offset, value & ((1n << 64n) - 1n)); putU64(data, offset + 8, value >> 64n);
}
function i32Be(value: number): Uint8Array { const out = new Uint8Array(4); new DataView(out.buffer).setInt32(0, value, false); return out; }
function i64Le(value: number): Uint8Array { const out = new Uint8Array(8); new DataView(out.buffer).setBigInt64(0, BigInt(value), true); return out; }

export interface BetaCaptureFixtureAccount extends MimirBetaCapturedAccount {
  readonly fixtureRole: "pool" | MimirBetaCaptureReadNodeRole;
  readonly fixtureIndex?: number;
}

function mint(address: Address, decimals = 6): BetaCaptureFixtureAccount {
  const data = new Uint8Array(82); putU64(data, 36, 1_000_000_000n); data[44] = decimals; data[45] = 1;
  return { fixtureRole: "base-mint", address, owner: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, executable: false, data };
}

function vault(role: "base-vault" | "quote-vault", address: Address, mintAddress: Address, authority: Address, amount: bigint): BetaCaptureFixtureAccount {
  const data = new Uint8Array(165); putKey(data, 0, mintAddress); putKey(data, 32, authority); putU64(data, 64, amount); data[108] = 1;
  return { fixtureRole: role, address, owner: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, executable: false, data };
}

export interface BetaCaptureFixtureOptions {
  readonly seed?: number;
  readonly baseMint?: Address;
  readonly quoteMint?: Address;
  readonly baseAmount?: bigint;
  readonly quoteAmount?: bigint;
  readonly curveLiquidity?: bigint;
  readonly cpmmAllocation?: 637;
  readonly reverseStorage?: boolean;
  readonly baseDecimals?: number;
  readonly quoteDecimals?: number;
  readonly pumpPoolIndex?: number;
  readonly currentTick?: number;
  readonly tickSpacing?: number;
  /** Orca: an adaptive-fee pool (tier seed @43 ≠ spacing) whose canonical Oracle carries this `trade_enable_timestamp`. */
  readonly orcaTradeEnableTimestamp?: bigint;
  readonly activeId?: number;
  readonly binStep?: number;
  readonly cluster?: "mainnet-beta" | "devnet";
}

export interface BetaCaptureFixture {
  readonly input: MimirBetaCaptureCandidateInput;
  readonly creation: MimirBetaPoolCreationBinding;
  readonly layout: ReturnType<typeof mimirBetaCapturePoolCoreLayout>;
  readonly poolAccount: Readonly<{ address: Address; owner: Address; data: Uint8Array }>;
  readonly fixtureAccounts: readonly BetaCaptureFixtureAccount[];
}

export async function makeBetaCaptureFixture(
  family: MimirBetaSourceFamily,
  options: BetaCaptureFixtureOptions = {},
): Promise<BetaCaptureFixture> {
  const seed = options.seed ?? 10;
  const descriptor = mimirBetaCaptureScanDescriptors(options.cluster).find((candidate) => candidate.family === family &&
    (family !== "raydium-cpmm" || candidate.allocationSize === (options.cpmmAllocation ?? 637)) &&
    (family !== "pumpswap" || candidate.allocationSize === 300))!;
  const programId = descriptor.programId; let pool = fixtureAddress(seed);
  const baseMint = options.baseMint ?? fixtureAddress(180); const quoteMint = options.quoteMint ?? fixtureAddress(220);
  const baseVault = fixtureAddress(seed + 40); const quoteVault = fixtureAddress(seed + 80);
  const mintA = options.reverseStorage ? quoteMint : baseMint; const mintB = options.reverseStorage ? baseMint : quoteMint;
  const vaultA = options.reverseStorage ? quoteVault : baseVault; const vaultB = options.reverseStorage ? baseVault : quoteVault;
  const decimalsA = options.reverseStorage ? (options.quoteDecimals ?? 6) : (options.baseDecimals ?? 6);
  const decimalsB = options.reverseStorage ? (options.baseDecimals ?? 6) : (options.quoteDecimals ?? 6);
  const baseAmount = options.baseAmount ?? 2_000_000n; const quoteAmount = options.quoteAmount ?? 3_000_000n;
  const data = new Uint8Array(descriptor.allocationSize); if (descriptor.discriminator) data.set(descriptor.discriminator);
  putKey(data, descriptor.mintAOffset, mintA); putKey(data, descriptor.mintBOffset, mintB);
  putKey(data, descriptor.vaultAOffset, vaultA); putKey(data, descriptor.vaultBOffset, vaultB);
  const accounts: BetaCaptureFixtureAccount[] = [{ fixtureRole: "pool", address: pool, owner: programId, executable: false, data }];
  let authority = pool; let config: Address | null = null; let observation: Address | null = null;
  let adapterType: MimirBetaAdapterType; let bindingVariant: "direct" | "routeable";

  if (family === "orca-whirlpool") {
    adapterType = 0; bindingVariant = "routeable"; config = (descriptor.planRule.kind === "orca-whirlpool" ? descriptor.planRule.whirlpoolsConfig : undefined) ?? MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET; putKey(data, 8, config);
    const spacing = options.tickSpacing ?? 1; const current = options.currentTick ?? 0;
    putU16(data, 41, spacing); putU16(data, 43, options.orcaTradeEnableTimestamp === undefined ? spacing : spacing + 1); putU128(data, 49, options.curveLiquidity ?? 1_000_000_000_000n); putU128(data, 65, Q64); putI32(data, 81, current);
    const configData = new Uint8Array(108); configData.set([157, 20, 49, 224, 217, 87, 193, 254]);
    accounts.push({ fixtureRole: "whirlpools-config", address: config, owner: programId, executable: false, data: configData });
    if (options.orcaTradeEnableTimestamp !== undefined) {
      const [oracle] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("oracle"), addressBytes(pool)] });
      const oracleData = new Uint8Array(254); oracleData.set([139, 194, 131, 179, 140, 179, 229, 244]); putKey(oracleData, 8, pool);
      putU64(oracleData, 40, options.orcaTradeEnableTimestamp);
      accounts.push({ fixtureRole: "orca-oracle", address: oracle, owner: programId, executable: false, data: oracleData });
    }
    const span = spacing * 88; const active = Math.floor(current / span) * span;
    for (const [position, start] of [active - span, active, active + span].entries()) {
      const [tickAddress] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("tick_array"), addressBytes(pool), utf8(start.toString())] });
      const tickData = new Uint8Array(9_988); tickData.set([69, 97, 189, 190, 110, 7, 66, 187]); putI32(tickData, 8, start); putKey(tickData, 9_956, pool);
      accounts.push({ fixtureRole: (["tick-array-lower", "tick-array-active", "tick-array-upper"] as const)[position]!, fixtureIndex: start, address: tickAddress, owner: programId, executable: false, data: tickData });
    }
  } else if (family === "raydium-clmm") {
    adapterType = 1; bindingVariant = "routeable"; config = fixtureAddress(seed + 120); putKey(data, 9, config);
    const spacing = options.tickSpacing ?? 1; const current = options.currentTick ?? 0;
    data[233] = decimalsA; data[234] = decimalsB; putU16(data, 235, spacing); putU128(data, 237, options.curveLiquidity ?? 1_000_000_000_000n);
    putU128(data, 253, Q64); putI32(data, 269, current); data[389] = 0; putU64(data, 1_080, 0n);
    const configData = new Uint8Array(117); configData.set(AMM_CONFIG_DISCRIMINATOR); putU16(configData, 51, spacing);
    accounts.push({ fixtureRole: "amm-config", address: config, owner: programId, executable: false, data: configData });
    const span = spacing * 60; const active = Math.floor(current / span) * span;
    for (const [position, start] of [active - span, active, active + span].entries()) {
      const [tickAddress] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("tick_array"), addressBytes(pool), i32Be(start)] });
      const tickData = new Uint8Array(10_240); tickData.set([192, 155, 85, 205, 49, 249, 129, 42]); putKey(tickData, 8, pool); putI32(tickData, 40, start);
      accounts.push({ fixtureRole: (["tick-array-lower", "tick-array-active", "tick-array-upper"] as const)[position]!, fixtureIndex: start, address: tickAddress, owner: programId, executable: false, data: tickData });
    }
    const [clmmObservation] = await getProgramDerivedAddress({ programAddress: programId,
      seeds: [utf8("observation"), addressBytes(pool)] });
    putKey(data, 201, clmmObservation);
    const clmmObservationData = new Uint8Array(4_483);
    clmmObservationData.set([122, 174, 197, 53, 129, 9, 165, 132]); putKey(clmmObservationData, 19, pool);
    accounts.push({ fixtureRole: "clmm-observation", address: clmmObservation, owner: programId, executable: false, data: clmmObservationData });
  } else if (family === "raydium-cpmm") {
    adapterType = 2; bindingVariant = "direct"; config = fixtureAddress(seed + 120); putKey(data, 8, config);
    putKey(data, 232, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID); putKey(data, 264, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID);
    const [derivedAuthority] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("vault_and_lp_mint_auth_seed")] }); authority = derivedAuthority;
    [observation] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("observation"), addressBytes(pool)] }); putKey(data, 296, observation);
    data[329] = 0; data[331] = decimalsA; data[332] = decimalsB; putU64(data, 373, 0n);
    const configData = new Uint8Array(236); configData.set(AMM_CONFIG_DISCRIMINATOR);
    const observationData = new Uint8Array(4_075); observationData.set([122, 174, 197, 53, 129, 9, 165, 132]); observationData[8] = 1; putKey(observationData, 11, pool);
    accounts.push({ fixtureRole: "amm-config", address: config, owner: programId, executable: false, data: configData });
    accounts.push({ fixtureRole: "cpmm-observation", address: observation, owner: programId, executable: false, data: observationData });
  } else if (family === "raydium-amm-v4") {
    adapterType = 4; bindingVariant = "direct";
    [authority] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("amm authority")] });
    putU64(data, 0, 1n); putU64(data, 32, BigInt(decimalsA)); putU64(data, 40, BigInt(decimalsB));
    putU64(data, 144, 0n); putU64(data, 152, 1_000n); putU64(data, 176, 1n); putU64(data, 184, 1_000n); putU64(data, 224, 0n);
    putKey(data, 688, "GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ" as Address);
    const market = fixtureAddress(seed + 121); const marketProgram = "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin" as Address;
    putKey(data, 496, bytesAddress(new Uint8Array(32))); putKey(data, 528, market); putKey(data, 560, marketProgram);
    accounts.push({ fixtureRole: "open-orders", address: bytesAddress(new Uint8Array(32)), owner: bytesAddress(new Uint8Array(32)), executable: true, data: new Uint8Array() });
    accounts[accounts.length - 1] = { fixtureRole: "open-orders", address: "11111111111111111111111111111111" as Address,
      owner: bytesAddress(new Uint8Array(32)), executable: true, data: new Uint8Array() };
    accounts.push({ fixtureRole: "market", address: market, owner: marketProgram, executable: false, data: Uint8Array.of(1) });
    accounts.push({ fixtureRole: "market-program", address: marketProgram, owner: fixtureAddress(seed + 122), executable: true, data: Uint8Array.of(1) });
  } else if (family === "pumpswap") {
    adapterType = 6; bindingVariant = "direct";
    const pumpProgram = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P" as Address;
    const pumpFeeProgram = "pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ" as Address;
    const [creator] = await getProgramDerivedAddress({ programAddress: pumpProgram, seeds: [utf8("pool-authority"), addressBytes(mintA)] });
    const poolIndex = options.pumpPoolIndex ?? 0;
    const indexBytes = new Uint8Array(2); new DataView(indexBytes.buffer).setUint16(0, poolIndex, true);
    const [derivedPool, bump] = await getProgramDerivedAddress({ programAddress: programId,
      seeds: [utf8("pool"), indexBytes, addressBytes(creator), addressBytes(mintA), addressBytes(mintB)] });
    pool = derivedPool; accounts[0] = { ...accounts[0]!, address: pool }; authority = pool; data[8] = bump; putU16(data, 9, poolIndex); putKey(data, 11, creator);
    const [lpMint] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("pool_lp_mint"), addressBytes(pool)] }); putKey(data, 107, lpMint);
    data[243] = 0; data[244] = 0;
    const [globalConfig] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("global_config")] });
    const globalData = new Uint8Array(940); globalData.set([149, 8, 156, 202, 160, 252, 176, 217]);
    putU64(globalData, 40, 10n); putU64(globalData, 48, 10n); putU64(globalData, 313, 0n); globalData[417] = 1; globalData[642] = 1; globalData[939] = 1;
    const [feeConfig, feeBump] = await getProgramDerivedAddress({ programAddress: pumpFeeProgram, seeds: [utf8("fee_config"), addressBytes(programId)] });
    const feeData = new Uint8Array(113); feeData.set([143, 52, 146, 187, 219, 123, 76, 155]); feeData[8] = feeBump;
    putKey(feeData, 9, fixtureAddress(seed + 123)); putU64(feeData, 41, 10n); putU64(feeData, 49, 10n); putU64(feeData, 57, 0n);
    new DataView(feeData.buffer).setUint32(65, 1, true); putU128(feeData, 69, 0n); putU64(feeData, 85, 10n); putU64(feeData, 93, 10n);
    new DataView(feeData.buffer).setUint32(109, 0, true);
    accounts.push({ fixtureRole: "global-config", address: globalConfig, owner: programId, executable: false, data: globalData });
    accounts.push({ fixtureRole: "fee-config", address: feeConfig, owner: pumpFeeProgram, executable: false, data: feeData });
  } else if (family === "meteora-dlmm") {
    const activeId = options.activeId ?? 0; const binStep = options.binStep ?? 10;
    adapterType = 3; bindingVariant = "direct"; putI32(data, 76, activeId); putU16(data, 80, binStep); data[82] = 0; data[86] = 0; putU64(data, 816, 0n);
    const window = Math.ceil(50 / binStep); const lowerIndex = Math.floor((activeId - window) / 70); const upperIndex = Math.floor((activeId + window) / 70);
    for (let index = lowerIndex; index <= upperIndex; index += 1) {
      const [binAddress] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("bin_array"), addressBytes(pool), i64Le(index)] });
      const binData = new Uint8Array(10_136); binData.set([92, 142, 92, 220, 5, 148, 70, 181]); putI64(binData, 8, BigInt(index)); putKey(binData, 24, pool);
      for (let id = Math.max(activeId - window, index * 70); id <= Math.min(activeId + window, index * 70 + 69); id += 1) {
        const offset = 56 + (id - index * 70) * 144; putU64(binData, offset, options.curveLiquidity ?? 100n); putU64(binData, offset + 8, options.curveLiquidity ?? 100n);
        if (id === activeId) putU128(binData, offset + 16, meteoraDlmmPriceFromIdX64(activeId, binStep));
      }
      accounts.push({ fixtureRole: "depth-bin-array", fixtureIndex: index, address: binAddress, owner: programId, executable: false, data: binData });
    }
  } else {
    adapterType = 7; bindingVariant = "direct";
    [authority] = await getProgramDerivedAddress({ programAddress: programId, seeds: [utf8("pool_authority")] });
    putU128(data, 360, (options.curveLiquidity ?? 1_000_000_000n) * Q64); putU128(data, 424, Q64 / 2n);
    putU128(data, 440, Q64 * 2n); putU128(data, 456, Q64); putU64(data, 472, 0n); data[480] = 0; data[481] = 0;
  }

  accounts.push(mint(baseMint, options.baseDecimals ?? 6), { ...mint(quoteMint, options.quoteDecimals ?? 6), fixtureRole: "quote-mint" });
  accounts.push(vault("base-vault", baseVault, baseMint, authority, baseAmount));
  accounts.push(vault("quote-vault", quoteVault, quoteMint, authority, quoteAmount));
  const byRole = new Map(accounts.map((account) => [account.fixtureRole, account.address]));
  const staticAccounts = family === "pumpswap" ? [
    { role: "base-mint" as const, address: baseMint }, { role: "quote-mint" as const, address: quoteMint },
    { role: "base-vault" as const, address: baseVault }, { role: "quote-vault" as const, address: quoteVault }, { role: "pool" as const, address: pool },
    { role: "global-config" as const, address: byRole.get("global-config")! }, { role: "fee-config" as const, address: byRole.get("fee-config")! },
  ] : family === "raydium-amm-v4" ? [
    { role: "base-vault" as const, address: baseVault }, { role: "quote-vault" as const, address: quoteVault }, { role: "pool" as const, address: pool },
    { role: "open-orders" as const, address: byRole.get("open-orders")! }, { role: "market" as const, address: byRole.get("market")! },
    { role: "market-program" as const, address: byRole.get("market-program")! },
  ] : [
    { role: "base-vault" as const, address: baseVault }, { role: "quote-vault" as const, address: quoteVault }, { role: "pool" as const, address: pool },
    ...(config ? [{ role: family === "orca-whirlpool" ? "whirlpools-config" as const : "amm-config" as const, address: config }] : []),
  ];
  const group = ({ "raydium-clmm": 1, "meteora-dlmm": 2, "meteora-damm-v2": 3, "orca-whirlpool": 4,
    "raydium-cpmm": 5, "raydium-amm-v4": 7, pumpswap: 8 } as const)[family];
  const creation: MimirBetaPoolCreationBinding = {
    adapterType, adapterVersion: 0, bindingVariant, tokenProgramId: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, token2022Mint: null, vaultAuthority: authority,
    staticAccounts, observationState: observation, operatorGroup: group, liquidityOwnerGroup: 0xffff, quoteAssetGroup: 1,
    bridgeOrWrapperGroup: 0, oracleSourceClass: group, upgradeAuthorityGroup: group,
  };
  const pair = { baseMint, quoteMint }; const context = { observedSlot: 10n, observedUnixTimestamp: 20n };
  const poolRow = { address: pool, owner: programId, executable: false, data };
  const expectedPlan = deriveMimirBetaCaptureReadPlan({ descriptor, primary: poolRow, pair, context });
  const rows = accounts.map(({ fixtureRole: _fixtureRole, fixtureIndex: _fixtureIndex, ...row }) => row);
  return {
    input: { descriptor, pair, context, expectedPlan, accounts: rows }, creation,
    layout: mimirBetaCapturePoolCoreLayout(descriptor), poolAccount: { address: pool, owner: programId, data }, fixtureAccounts: accounts,
  };
}

export function cloneBetaCaptureFixture(fixture: BetaCaptureFixture): BetaCaptureFixture {
  const fixtureAccounts = fixture.fixtureAccounts.map((account) => ({ ...account, data: account.data.slice() }));
  const pool = fixtureAccounts.find((account) => account.fixtureRole === "pool")!;
  const accounts = fixtureAccounts.map(({ fixtureRole: _fixtureRole, fixtureIndex: _fixtureIndex, ...row }) => row);
  const primary = { address: pool.address, owner: pool.owner, executable: pool.executable, data: pool.data };
  const expectedPlan = deriveMimirBetaCaptureReadPlan({ descriptor: fixture.input.descriptor, primary, pair: fixture.input.pair, context: fixture.input.context });
  return {
    input: { ...fixture.input, pair: { ...fixture.input.pair }, context: { ...fixture.input.context }, expectedPlan, accounts },
    creation: { ...fixture.creation, staticAccounts: fixture.creation.staticAccounts.map((account) => ({ ...account })) },
    layout: { ...fixture.layout, discriminator: fixture.layout.discriminator?.slice() ?? null },
    poolAccount: { address: pool.address, owner: pool.owner, data: pool.data }, fixtureAccounts,
  };
}
