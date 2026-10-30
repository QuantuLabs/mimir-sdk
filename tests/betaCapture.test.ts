import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Key, getKeySerializer } from "@metaplex-foundation/mpl-core";
import { address, type Address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import { none, publicKey } from "@metaplex-foundation/umi";
import { option, publicKey as publicKeySerializer, string, u32, u64 } from "@metaplex-foundation/umi/serializers";
import {
  mimirBetaDlmmRouteableLegacyDepth,
  MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET,
  MIMIR_BETA_SPL_TOKEN_PROGRAM_ID,
  deriveMimirBetaPumpSwapBoostVault,
  MIMIR_BETA_TOKEN_2022_PROGRAM_ID,
  MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID,
  assertUnambiguousMimirBetaCaptureCandidates,
  compareMimirBetaCaptureCandidates,
  decodeMimirBetaCaptureCandidate,
  decodeUpgradeableProgramRelation,
  deriveMimirBetaCaptureReadPlan,
  mimirBetaCaptureScanDescriptors,
  orcaSqrtPriceX64FromTickIndex,
  raydiumSqrtPriceX64FromTickIndex,
  revalidateMimirBetaCapture,
  revalidateMimirBetaCaptureCandidate,
  selectMimirBetaCaptureCohort,
  type MimirBetaCapturedAccount,
  type MimirBetaCaptureExecutableProgramRole,
  type MimirBetaCaptureCandidateInput,
  type MimirBetaCaptureProgramRelation,
  type MimirBetaCaptureReadPlan,
  type MimirBetaCaptureRevalidationInput,
  type MimirBetaCaptureRole,
  type MimirBetaCaptureRoleNode,
  type MimirBetaCaptureSelectedPoolPlan,
  mimirOrcaAdmissionOracle,
} from "../src/beta/capture.js";
import { buildMimirBetaPoolCreationBinding } from "../src/beta/discovery.js";
import { PUMPSWAP_REAL_287_ACCOUNTS, PUMPSWAP_REAL_287_POOL } from "./fixtures/pumpswapReal287.js";
import { decodeMimirBetaCaptureRpcAccount, explainMimirBetaTokenRefusal, MimirBetaPoolIneligibleError } from "../src/beta/index.js";
import { freshAdapterAccounts } from "../src/beta/live.js";
import { addressBytes, bytesAddress, concatBytes } from "../src/beta/bytes.js";
import { classifyToken2022ClmmPair, isToken2022ClmmPolicyError } from "../src/token2022Clmm.js";
import { MIMIR_COND } from "../src/liveness.js";
import { Q64, meteoraDlmmPriceFromIdX64 } from "../src/math.js";
import {
  MIMIR_BETA_MPL_CORE_PROGRAM_ID,
  MIMIR_BETA_SYSTEM_PROGRAM_ID,
  type MimirBetaDeployment,
} from "../src/beta/deployment.js";
import {
  createMimir8004IdentityAdapter,
  decodeMimir8004RegistryConfig,
  decodeMimir8004RootConfig,
} from "../src/beta/identity8004.js";
import type { MimirBetaAccount, MimirBetaSourceFamily } from "../src/beta/types.js";
import {
  inspectRaydiumClmmSourceFloorProof,
  inspectMeteoraDlmmSourceFloorProof,
  type InspectMeteoraDlmmSourceFloorProofParams,
} from "../src/dlmmSourceFloorProof.js";
import {
  METEORA_DLMM_PROGRAM_ID,
  MIMIR_PROGRAM_ID,
  RAYDIUM_CLMM_MAINNET_PROGRAM_ID,
  SOURCE_OFFSETS,
  MIMIR_MAINNET_USDC_MINT,
  SPL_TOKEN_PROGRAM_ID,
} from "../src/constants.js";
import { buildTestMeteoraDlmmSourceConfigHeader, buildTestRaydiumClmmSourceConfigHeader, TEST_FEED_ID } from "../src/fixtures.js";
import { findSourceConfigPda } from "../src/pda.js";
import { cloneBetaCaptureFixture, fixtureAddress, makeBetaCaptureFixture, type BetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";

const FAMILIES: readonly MimirBetaSourceFamily[] = [
  "orca-whirlpool", "raydium-clmm", "raydium-cpmm", "meteora-dlmm", "meteora-damm-v2",
];
const ALL_FAMILIES: readonly MimirBetaSourceFamily[] = [...FAMILIES, "raydium-amm-v4", "pumpswap"];

function poolRow(fixture: BetaCaptureFixture): MimirBetaCapturedAccount {
  return fixture.input.accounts.find((row) => row.address === fixture.input.expectedPlan.pool)!;
}

function replaceRow(fixture: BetaCaptureFixture, address: string,
  replace: (row: MimirBetaCapturedAccount) => MimirBetaCapturedAccount): MimirBetaCaptureCandidateInput {
  return { ...fixture.input, accounts: fixture.input.accounts.map((row) => row.address === address ? replace(row) : row) };
}

function planFor(fixture: BetaCaptureFixture, pair = fixture.input.pair, primary = poolRow(fixture)): MimirBetaCaptureReadPlan {
  return deriveMimirBetaCaptureReadPlan({ descriptor: fixture.input.descriptor, primary, pair, context: fixture.input.context });
}

async function rejects(input: MimirBetaCaptureCandidateInput, codes?: readonly string[]): Promise<void> {
  await assert.rejects(() => decodeMimirBetaCaptureCandidate(input), (error) =>
    (codes ?? ["POOL_INELIGIBLE", "ACCOUNT_OWNER_MISMATCH", "ACCOUNT_MALFORMED", "PDA_MISMATCH", "CAPTURE_PLAN_MISMATCH"])
      .includes((error as { code?: string }).code ?? ""));
}

function writeFloorU128(data: Uint8Array, offset: number, value: bigint): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigUint64(offset, value & ((1n << 64n) - 1n), true);
  view.setBigUint64(offset + 8, value >> 64n, true);
}

type PumpFeesFixture = readonly [bigint, bigint, bigint];

async function currentPumpInput(options: {
  quoteMint?: Address;
  poolIndex?: number;
  mayhem?: boolean;
  creatorFeeEnabled?: boolean;
  maxCreatorFee?: bigint;
  poolCreatorFee?: bigint;
  coinCreator?: boolean;
  flat?: PumpFeesFixture;
  regular?: readonly Readonly<{ threshold: bigint; fees: PumpFeesFixture }>[];
  stable?: readonly Readonly<{ threshold: bigint; fees: PumpFeesFixture }>[];
  exotic?: PumpFeesFixture;
} = {}): Promise<MimirBetaCaptureCandidateInput> {
  const fixture = await makeBetaCaptureFixture("pumpswap", {
    seed: 94,
    ...(options.quoteMint === undefined ? {} : { quoteMint: options.quoteMint }),
    ...(options.poolIndex === undefined ? {} : { pumpPoolIndex: options.poolIndex }),
  });
  const feeRow = fixture.fixtureAccounts.find((row) => row.fixtureRole === "fee-config")!;
  const feeData = new Uint8Array(4_097);
  feeData.set(feeRow.data.subarray(0, 41));
  const writeFees = (offset: number, fees: PumpFeesFixture): void => {
    fees.forEach((value, index) => new DataView(feeData.buffer).setBigUint64(offset + index * 8, value, true));
  };
  const writeTiers = (offset: number, tiers: NonNullable<typeof options.regular>): number => {
    new DataView(feeData.buffer).setUint32(offset, tiers.length, true);
    offset += 4;
    for (const tier of tiers) {
      writeFloorU128(feeData, offset, tier.threshold);
      writeFees(offset + 16, tier.fees);
      offset += 40;
    }
    return offset;
  };
  writeFees(41, options.flat ?? [0n, 0n, 0n]);
  let offset = writeTiers(65, options.regular ?? [{ threshold: 0n, fees: [1n, 1n, 1n] }]);
  offset = writeTiers(offset, options.stable ?? []);
  writeFees(offset, options.exotic ?? [0n, 0n, 0n]);

  const globalRow = fixture.fixtureAccounts.find((row) => row.fixtureRole === "global-config")!;
  const globalData = new Uint8Array(949);
  globalData.set(globalRow.data);
  globalData[940] = options.creatorFeeEnabled ? 1 : 0;
  new DataView(globalData.buffer).setBigUint64(941, options.maxCreatorFee ?? 0n, true);

  const pool = { ...poolRow(fixture), data: poolRow(fixture).data.slice() };
  pool.data[243] = options.mayhem ? 1 : 0;
  new DataView(pool.data.buffer).setBigUint64(261, options.poolCreatorFee ?? 0n, true);
  if (options.coinCreator) pool.data.fill(1, 211, 243);
  const accounts = fixture.input.accounts.map((row) => row.address === pool.address
    ? pool
    : row.address === feeRow.address
      ? { ...row, data: feeData }
      : row.address === globalRow.address
        ? { ...row, data: globalData }
        : row);
  return { ...fixture.input, expectedPlan: planFor(fixture, fixture.input.pair, pool), accounts };
}

function floorProofInput(
  fixture: BetaCaptureFixture,
  minima: Readonly<{ liquidity: bigint; depth: bigint }>,
): InspectMeteoraDlmmSourceFloorProofParams {
  const candidatePool = fixture.input.expectedPlan.pool;
  const poolRow = fixture.input.accounts.find((row) => row.address === candidatePool)!;
  const sourceConfigData = buildTestMeteoraDlmmSourceConfigHeader(0, (data) => {
    METEORA_DLMM_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.programId);
    new PublicKey(candidatePool).toBuffer().copy(data, SOURCE_OFFSETS.poolOrMarket);
    new PublicKey(fixture.input.expectedPlan.baseVault).toBuffer().copy(data, SOURCE_OFFSETS.baseVault);
    new PublicKey(fixture.input.expectedPlan.quoteVault).toBuffer().copy(data, SOURCE_OFFSETS.quoteVault);
    new PublicKey(fixture.input.pair.baseMint).toBuffer().copy(data, SOURCE_OFFSETS.baseMint);
    new PublicKey(fixture.input.pair.quoteMint).toBuffer().copy(data, SOURCE_OFFSETS.quoteMint);
    SPL_TOKEN_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.tokenProgram);
    new PublicKey(candidatePool).toBuffer().copy(data, SOURCE_OFFSETS.vaultAuthority);
    writeFloorU128(data, SOURCE_OFFSETS.minLiquidityNative, minima.liquidity);
    writeFloorU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, minima.depth);
  });
  const contextual = (row: MimirBetaCapturedAccount) => ({
    address: new PublicKey(row.address),
    owner: new PublicKey(row.owner),
    data: row.data,
    executable: row.executable,
    contextSlot: 477_000_000n,
  });
  return {
    expectedFeedId: TEST_FEED_ID,
    expectedSourceIndex: 0,
    currentUnixTs: fixture.input.context.observedUnixTimestamp,
    sourceConfig: {
      address: findSourceConfigPda(TEST_FEED_ID, 0)[0],
      owner: MIMIR_PROGRAM_ID,
      data: sourceConfigData,
      executable: false,
      contextSlot: 477_000_000n,
    },
    pool: contextual(poolRow),
    captureAccounts: fixture.input.accounts.map(contextual),
  };
}

const descriptors = mimirBetaCaptureScanDescriptors();
assert.equal(descriptors.length, 9);
assert.equal(new Set(descriptors.map((descriptor) => descriptor.family)).size, 7);
assert.equal(new Set(descriptors.map((descriptor) => descriptor.descriptorId)).size, 9);
assert.equal(new Set(descriptors.map((descriptor) => descriptor.descriptorHash)).size, 9);
assert(descriptors.every((descriptor) => descriptor.descriptorHash.length === 64 && descriptor.maxResults === 5 &&
  descriptor.maxAuxiliaryAccounts <= (descriptor.family === "raydium-clmm" || descriptor.family === "orca-whirlpool" ? 9 : 8)));
assert.deepEqual(descriptors.filter((descriptor) => descriptor.family === "raydium-cpmm").map((descriptor) => descriptor.allocationSize), [637]);

const fakePrimary = { address: fixtureAddress(1), owner: descriptors[0]!.programId, executable: false,
  data: new Uint8Array(descriptors[0]!.allocationSize) };
const fakePlanInput = { primary: fakePrimary, pair: { baseMint: fixtureAddress(2), quoteMint: fixtureAddress(3) },
  context: { observedSlot: 0n, observedUnixTimestamp: 0n } };
assert.throws(() => deriveMimirBetaCaptureReadPlan({ ...fakePlanInput,
  descriptor: { ...descriptors[0]!, descriptorId: "caller-descriptor" } }),
  (error) => (error as { code?: string }).code === "UNKNOWN_CAPTURE_DESCRIPTOR");
assert.throws(() => deriveMimirBetaCaptureReadPlan({ ...fakePlanInput,
  descriptor: Object.assign({ ...descriptors[0]! }, { callback: () => true }) }),
  (error) => (error as { code?: string }).code === "UNKNOWN_CAPTURE_DESCRIPTOR");

const decodedByFamily = new Map<MimirBetaSourceFamily, Awaited<ReturnType<typeof decodeMimirBetaCaptureCandidate>>>();
for (let index = 0; index < ALL_FAMILIES.length; index += 1) {
  const family = ALL_FAMILIES[index]!; const fixture = await makeBetaCaptureFixture(family, { seed: 10 + index * 27 });
  const plan = planFor(fixture);
  assert.equal(plan.schema, "mimir-beta-capture-read-plan-v1");
  assert.equal(plan.descriptorId, fixture.input.descriptor.descriptorId);
  assert.equal(plan.baseMint, fixture.input.pair.baseMint); assert.equal(plan.quoteMint, fixture.input.pair.quoteMint);
  assert.equal(plan.direction, "quote-per-base"); assert.equal(plan.primaryDataSha256.length, 64); assert.equal(plan.planHash.length, 64);
  assert.deepEqual([...plan.allAddresses], [...plan.allAddresses].sort((a, b) => Buffer.compare(addressBytes(a), addressBytes(b))));
  assert(Object.isFrozen(plan) && Object.isFrozen(plan.auxiliary) && Object.isFrozen(plan.allAddresses));
  const candidate = await decodeMimirBetaCaptureCandidate(fixture.input);
  assert.equal(candidate.readPlanHash, plan.planHash); assert.equal(candidate.descriptorHash, plan.descriptorHash);
  assert(candidate.minLiquidityNative > 0n && candidate.minDepthTo50BpsNative > 0n);
  if (family !== "meteora-dlmm") assert.notEqual(candidate.minLiquidityNative, candidate.minDepthTo50BpsNative);
  decodedByFamily.set(family, candidate);
  const rejectPrimary = (mutate: (data: Uint8Array) => void, expectedCodes: readonly string[]) => {
    const primary = { ...poolRow(fixture), data: poolRow(fixture).data.slice() }; mutate(primary.data);
    assert.throws(() => planFor(fixture, fixture.input.pair, primary),
      (error) => expectedCodes.includes((error as { code?: string }).code ?? ""));
  };
  assert.throws(() => planFor(fixture, fixture.input.pair, { ...poolRow(fixture), executable: true }),
    (error) => (error as { code?: string }).code === "ACCOUNT_OWNER_MISMATCH");
  assert.throws(() => planFor(fixture, fixture.input.pair, { ...poolRow(fixture), owner: fixtureAddress(250) }),
    (error) => (error as { code?: string }).code === "ACCOUNT_OWNER_MISMATCH");
  assert.throws(() => planFor(fixture, fixture.input.pair, { ...poolRow(fixture), data: poolRow(fixture).data.slice(0, -1) }),
    (error) => (error as { code?: string }).code === "UNKNOWN_CAPTURE_ALLOCATION");
  if (fixture.input.descriptor.discriminator) rejectPrimary((data) => { data[0] ^= 1; }, ["ACCOUNT_MALFORMED"]);
  assert.throws(() => planFor(fixture, { baseMint: fixtureAddress(246), quoteMint: fixture.input.pair.quoteMint }),
    (error) => (error as { code?: string }).code === "POOL_INELIGIBLE");
  if (fixture.input.descriptor.status) {
    const status = fixture.input.descriptor.status;
    rejectPrimary((data) => {
      if (status.acceptedU64) new DataView(data.buffer).setBigUint64(status.offset, 0n, true);
      else data[status.offset] = status.disabledMask ?? (status.enabled! + 1);
    }, ["POOL_INELIGIBLE"]);
  }
  if (fixture.input.descriptor.activation) {
    const activation = fixture.input.descriptor.activation;
    rejectPrimary((data) => { new DataView(data.buffer).setBigUint64(activation.offset, 21n, true); }, ["POOL_INELIGIBLE"]);
  }
  await rejects({ ...fixture.input, accounts: fixture.input.accounts.slice(1) }, ["CAPTURE_PLAN_MISMATCH"]);
  await rejects({ ...fixture.input, accounts: [...fixture.input.accounts, fixture.input.accounts[0]!] }, ["CAPTURE_PLAN_MISMATCH"]);
  await rejects(replaceRow(fixture, plan.baseVault, (row) => ({ ...row, executable: true })), ["ACCOUNT_MALFORMED"]);
  await rejects(replaceRow(fixture, plan.quoteVault, (row) => ({ ...row, owner: fixtureAddress(249) })));
}

const dlmmFloorFixture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 260 });
const dlmmFloorCandidate = await decodeMimirBetaCaptureCandidate(dlmmFloorFixture.input);
const exactFloorInput = floorProofInput(dlmmFloorFixture, {
  liquidity: dlmmFloorCandidate.minLiquidityNative,
  depth: dlmmFloorCandidate.minDepthTo50BpsNative,
});
const exactFloor = await inspectMeteoraDlmmSourceFloorProof(exactFloorInput);
assert.equal(exactFloor.status, "source_floor_validated");
if (exactFloor.status !== "source_floor_validated") throw new Error("expected exact DLMM floor proof");
assert.equal(exactFloor.proofScope, "dlmm_source_floor_only");
assert.equal(exactFloor.actionabilityRequirement, "requires_atomic_topology_validated");
assert.equal(exactFloor.liquidityNative, dlmmFloorCandidate.minLiquidityNative);
assert.equal(exactFloor.depthTo50BpsNative, dlmmFloorCandidate.minDepthTo50BpsNative);
assert.equal(exactFloor.sourceConfigRevision, 1n);
assert.equal(exactFloor.sourceSetRevision, 1n);

const overLiquidityFloor = await inspectMeteoraDlmmSourceFloorProof(floorProofInput(dlmmFloorFixture, {
  liquidity: dlmmFloorCandidate.minLiquidityNative + 1n,
  depth: dlmmFloorCandidate.minDepthTo50BpsNative,
}));
assert.equal(overLiquidityFloor.status, "below_minimum");
if (overLiquidityFloor.status !== "below_minimum") throw new Error("expected DLMM liquidity shortfall");
assert.equal(overLiquidityFloor.belowLiquidityMinimum, true);
assert.equal(overLiquidityFloor.belowDepthMinimum, false);

const overDepthFloor = await inspectMeteoraDlmmSourceFloorProof(floorProofInput(dlmmFloorFixture, {
  liquidity: dlmmFloorCandidate.minLiquidityNative,
  depth: dlmmFloorCandidate.minDepthTo50BpsNative + 1n,
}));
assert.equal(overDepthFloor.status, "below_minimum");
if (overDepthFloor.status !== "below_minimum") throw new Error("expected DLMM depth shortfall");
assert.equal(overDepthFloor.belowLiquidityMinimum, false);
assert.equal(overDepthFloor.belowDepthMinimum, true);

const unavailableFloor = async (input: InspectMeteoraDlmmSourceFloorProofParams, reason: string) => {
  const result = await inspectMeteoraDlmmSourceFloorProof(input);
  assert.equal(result.status, "unavailable");
  if (result.status !== "unavailable") throw new Error("expected unavailable DLMM proof");
  assert.equal(result.reason, reason);
};
{
  const input = floorProofInput(dlmmFloorFixture, {
    liquidity: dlmmFloorCandidate.minLiquidityNative,
    depth: dlmmFloorCandidate.minDepthTo50BpsNative,
  });
  await unavailableFloor({ ...input, sourceConfig: { ...input.sourceConfig, owner: new PublicKey(Buffer.alloc(32, 251)) } }, "invalid_source_config");
  await unavailableFloor({ ...input, sourceConfig: { ...input.sourceConfig, address: new PublicKey(Buffer.alloc(32, 252)) } }, "invalid_source_config");
  const wrongSourcePool = Uint8Array.from(input.sourceConfig.data);
  new PublicKey(fixtureAddress(253)).toBuffer().copy(wrongSourcePool, SOURCE_OFFSETS.poolOrMarket);
  await unavailableFloor({ ...input, sourceConfig: { ...input.sourceConfig, data: wrongSourcePool } }, "invalid_pool");
  const shiftedContext = input.captureAccounts.map((account, index) => index === 1
    ? { ...account, contextSlot: account.contextSlot + 1n } : account);
  await unavailableFloor({ ...input, captureAccounts: shiftedContext }, "context_mismatch");

  const malformedRole = async (
    role: "depth-bin-array" | "base-mint" | "base-vault",
    corrupt: (row: InspectMeteoraDlmmSourceFloorProofParams["captureAccounts"][number]) =>
      InspectMeteoraDlmmSourceFloorProofParams["captureAccounts"][number],
  ) => {
    const account = dlmmFloorFixture.fixtureAccounts.find((row) => row.fixtureRole === role &&
      (role !== "depth-bin-array" || row.fixtureIndex === 0))!;
    const brokenAccounts = input.captureAccounts.map((row) => row.address.toBase58() === account.address
      ? corrupt({ ...row, data: row.data.slice() }) : row);
    await unavailableFloor({ ...input, captureAccounts: brokenAccounts }, "invalid_capture");
  };
  await malformedRole("depth-bin-array", (row) => { const data = row.data.slice(); data[0] ^= 1; return { ...row, data }; });
  await malformedRole("base-mint", (row) => ({ ...row, owner: new PublicKey(fixtureAddress(254)) }));
  await malformedRole("base-vault", (row) => {
    const data = row.data.slice(); data.set(addressBytes(fixtureAddress(255)), 32); return { ...row, data };
  });
}

{
  const input = floorProofInput(dlmmFloorFixture, {
    liquidity: dlmmFloorCandidate.minLiquidityNative,
    depth: dlmmFloorCandidate.minDepthTo50BpsNative,
  });
  const pending = inspectMeteoraDlmmSourceFloorProof(input);
  writeFloorU128(input.sourceConfig.data, SOURCE_OFFSETS.minLiquidityNative, dlmmFloorCandidate.minLiquidityNative + 1n);
  writeFloorU128(input.sourceConfig.data, SOURCE_OFFSETS.minDepthTo50BpsNative, dlmmFloorCandidate.minDepthTo50BpsNative + 1n);
  for (const account of input.captureAccounts) {
    if (dlmmFloorFixture.fixtureAccounts.some((fixtureAccount) =>
      fixtureAccount.address === account.address.toBase58() && fixtureAccount.fixtureRole === "depth-bin-array")) {
      account.data.fill(0);
    }
  }
  const protectedFloor = await pending;
  assert.equal(protectedFloor.status, "source_floor_validated");
  if (protectedFloor.status !== "source_floor_validated") throw new Error("input mutation replaced DLMM proof cohort");
  assert.equal(protectedFloor.liquidityNative, dlmmFloorCandidate.minLiquidityNative);
  assert.equal(protectedFloor.depthTo50BpsNative, dlmmFloorCandidate.minDepthTo50BpsNative);
  assert.equal(protectedFloor.minLiquidityNative, dlmmFloorCandidate.minLiquidityNative);
  assert.equal(protectedFloor.minDepthTo50BpsNative, dlmmFloorCandidate.minDepthTo50BpsNative);
}

const orca = await makeBetaCaptureFixture("orca-whirlpool", { seed: 151 });
assert.equal(orca.input.expectedPlan.auxiliary.find((node) => node.role === "whirlpools-config")!.address,
  MIMIR_BETA_ORCA_WHIRLPOOLS_CONFIG_MAINNET);
const unsupportedConfig = bytesAddress(Uint8Array.from({ length: 32 }, () => 245));
const unsupportedPrimary = { ...poolRow(orca), data: poolRow(orca).data.slice() };
unsupportedPrimary.data.set(addressBytes(unsupportedConfig), 8);
assert.throws(() => planFor(orca, orca.input.pair, unsupportedPrimary),
  (error) => (error as { code?: string }).code === "POOL_INELIGIBLE");
const noncanonicalPrimary = { ...poolRow(orca), data: poolRow(orca).data.slice() };
noncanonicalPrimary.data.set(addressBytes(fixtureAddress(245)), 8);
assert.throws(() => planFor(orca, orca.input.pair, noncanonicalPrimary),
  (error) => (error as { code?: string }).code === "POOL_INELIGIBLE");
const zeroOrcaSpacing = { ...poolRow(orca), data: poolRow(orca).data.slice() };
new DataView(zeroOrcaSpacing.data.buffer).setUint16(41, 0, true);
assert.throws(() => planFor(orca, orca.input.pair, zeroOrcaSpacing));
const overflowOrcaTick = { ...poolRow(orca), data: poolRow(orca).data.slice() };
new DataView(overflowOrcaTick.data.buffer).setInt32(81, 2_147_483_647, true);
assert.throws(() => planFor(orca, orca.input.pair, overflowOrcaTick));

// Adaptive Orca (tier seed @43 ≠ spacing): the canonical Oracle is a plan role; trade_enable_timestamp ≤ capture Clock (20).
assert.equal(orca.input.expectedPlan.auxiliary.some((node) => node.role === "orca-oracle"), false, "legacy Orca: no Oracle role");
{
  const code = (c: string) => (error: unknown) => (error as { code?: string }).code === c;
  for (const t of [0n, 19n, 20n]) {
    const f = await makeBetaCaptureFixture("orca-whirlpool", { seed: 152, orcaTradeEnableTimestamp: t });
    assert.equal(f.input.expectedPlan.allAddresses.length, 10, "adaptive capture count");
    assert.equal((await decodeMimirBetaCaptureCandidate(f.input)).family, "orca-whirlpool", `T=${t} admitted`);
  }
  const f = await makeBetaCaptureFixture("orca-whirlpool", { seed: 152, orcaTradeEnableTimestamp: 21n });
  await assert.rejects(decodeMimirBetaCaptureCandidate(f.input), code("POOL_INELIGIBLE"), "future enablement");
  const ok = await makeBetaCaptureFixture("orca-whirlpool", { seed: 152, orcaTradeEnableTimestamp: 0n });
  const oracle = ok.input.expectedPlan.auxiliary.find((node) => node.role === "orca-oracle")!.address;
  const row = ok.input.accounts.find((a) => a.address === oracle)!, pool = ok.input.expectedPlan.pool, program = ok.input.descriptor.programId;
  const forge = (edit: (d: Uint8Array) => Uint8Array, patch = {}) => ({ ...ok.input, accounts: ok.input.accounts.map((a) => a.address === oracle ? { ...a, data: edit(a.data.slice()), ...patch } : a) });
  await assert.rejects(decodeMimirBetaCaptureCandidate(forge((d) => d, { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID })), code("ACCOUNT_OWNER_MISMATCH"));
  await assert.rejects(decodeMimirBetaCaptureCandidate(forge((d) => d, { executable: true })), code("ACCOUNT_MALFORMED"));
  await assert.rejects(decodeMimirBetaCaptureCandidate(forge((d) => { d[0]! ^= 1; return d; })), code("ACCOUNT_MALFORMED"), "discriminator");
  await assert.rejects(decodeMimirBetaCaptureCandidate(forge((d) => { d[8]! ^= 1; return d; })), code("ACCOUNT_MALFORMED"), "embedded pool");
  await assert.rejects(decodeMimirBetaCaptureCandidate(forge((d) => d.slice(0, 253))), code("ACCOUNT_MALFORMED"), "truncated");
  await assert.rejects(decodeMimirBetaCaptureCandidate(forge(() => new Uint8Array(), { owner: MIMIR_BETA_SYSTEM_PROGRAM_ID })), code("ACCOUNT_OWNER_MISMATCH"), "absent");
  await assert.rejects(decodeMimirBetaCaptureCandidate({ ...ok.input, accounts: ok.input.accounts.filter((a) => a.address !== oracle) }), code("CAPTURE_PLAN_MISMATCH"), "omitted");
  assert.throws(() => mimirOrcaAdmissionOracle(null, pool, program, 20n), code("ACCOUNT_MALFORMED"));
  assert.throws(() => mimirOrcaAdmissionOracle({ ...row, address: fixtureAddress(246) }, pool, program, 20n), code("PDA_MISMATCH"));
  assert.throws(() => mimirOrcaAdmissionOracle({ ...row, data: Uint8Array.from([...row.data, 0]) }, pool, program, 20n), code("ACCOUNT_MALFORMED"), "oversized");
}
for (const tick of [-89, -1, 0, 89]) {
  const fixture = await makeBetaCaptureFixture("orca-whirlpool", { seed: 40 + Math.abs(tick), currentTick: tick });
  const active = Math.floor(tick / 88) * 88;
  assert.deepEqual(fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-"))
    .map((node) => Number(node.index)).sort((a, b) => a - b), [active - 88, active, active + 88]);
  assert.deepEqual(new Set(fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-")).map((node) => node.address)),
    new Set(fixture.fixtureAccounts.filter((row) => row.fixtureRole.startsWith("tick-array-")).map((row) => row.address)));
}
for (const tick of [-61, -1, 0, 61]) {
  const fixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 80 + Math.abs(tick), currentTick: tick });
  const active = Math.floor(tick / 60) * 60;
  assert.deepEqual(fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-"))
    .map((node) => Number(node.index)).sort((a, b) => a - b), [active - 60, active, active + 60]);
  assert.deepEqual(new Set(fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-")).map((node) => node.address)),
    new Set(fixture.fixtureAccounts.filter((row) => row.fixtureRole.startsWith("tick-array-")).map((row) => row.address)));
}
const sparseRaydium = await makeBetaCaptureFixture("raydium-clmm", { seed: 202, currentTick: 0 });
const raydiumTickNodes = sparseRaydium.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-"));
const sparseRaydiumRows = (input: MimirBetaCaptureCandidateInput, nodes: typeof raydiumTickNodes) => {
  const sparseAddresses = new Set(nodes.map((node) => node.address));
  return { ...input, accounts: input.accounts.map((row) => sparseAddresses.has(row.address) ? {
    ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, data: new Uint8Array(),
  } : row) };
};
const initializedRaydium = await decodeMimirBetaCaptureCandidate(sparseRaydium.input);
assert.equal(initializedRaydium.family, "raydium-clmm");
assert.equal(initializedRaydium.adapterVersion, 0, "valid immature oracle remains spot-creatable");
const clmmOracleNode = sparseRaydium.input.expectedPlan.auxiliary.find((node) => node.role === "clmm-observation")!;
const nonPdaClmmOracle = fixtureAddress(253);
assert.notEqual(nonPdaClmmOracle, clmmOracleNode.address);
const nonPdaClmmPool = poolRow(sparseRaydium);
const nonPdaClmmPoolData = nonPdaClmmPool.data.slice();
nonPdaClmmPoolData.set(addressBytes(nonPdaClmmOracle), 201);
const nonPdaClmmAccounts = sparseRaydium.input.accounts.map((row) => row.address === nonPdaClmmPool.address
  ? { ...row, data: nonPdaClmmPoolData }
  : row.address === clmmOracleNode.address ? { ...row, address: nonPdaClmmOracle } : row);
const nonPdaClmmPrimary = { ...nonPdaClmmPool, data: nonPdaClmmPoolData };
const nonPdaClmmPlan = deriveMimirBetaCaptureReadPlan({ descriptor: sparseRaydium.input.descriptor,
  primary: nonPdaClmmPrimary, pair: sparseRaydium.input.pair, context: sparseRaydium.input.context });
assert.equal(nonPdaClmmPlan.auxiliary.find((node) => node.role === "clmm-observation")?.address, nonPdaClmmOracle);
const nonPdaClmmCandidate = await decodeMimirBetaCaptureCandidate({ ...sparseRaydium.input,
  expectedPlan: nonPdaClmmPlan, accounts: nonPdaClmmAccounts });
assert.equal(nonPdaClmmCandidate.readPlanHash, nonPdaClmmPlan.planHash);
assert.equal(nonPdaClmmCandidate.adapterVersion, 0);
const malformedClmmOwner = { ...sparseRaydium.input, accounts: sparseRaydium.input.accounts.map((row) =>
  row.address === clmmOracleNode.address ? { ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID } : row) };
await assert.rejects(() => decodeMimirBetaCaptureCandidate(malformedClmmOwner));
const malformedClmmOracle = { ...sparseRaydium.input, accounts: sparseRaydium.input.accounts.map((row) => {
  if (row.address !== clmmOracleNode.address) return row;
  const data = row.data.slice(); data[8] = 2; return { ...row, data };
}) };
await assert.rejects(() => decodeMimirBetaCaptureCandidate(malformedClmmOracle), /InvalidRaydiumClmmObservationState/);
const invalidClmmPointer = poolRow(sparseRaydium); const invalidClmmPoolData = invalidClmmPointer.data.slice();
invalidClmmPoolData.set(new Uint8Array(32), 201);
assert.throws(() => deriveMimirBetaCaptureReadPlan({ descriptor: sparseRaydium.input.descriptor,
  primary: { ...invalidClmmPointer, data: invalidClmmPoolData }, pair: sparseRaydium.input.pair,
  context: sparseRaydium.input.context }), (error) => (error as { code?: string }).code === "PDA_MISMATCH");
invalidClmmPoolData.set(addressBytes(invalidClmmPointer.address), 201);
assert.throws(() => deriveMimirBetaCaptureReadPlan({ descriptor: sparseRaydium.input.descriptor,
  primary: { ...invalidClmmPointer, data: invalidClmmPoolData }, pair: sparseRaydium.input.pair,
  context: sparseRaydium.input.context }), (error) => (error as { code?: string }).code === "PDA_MISMATCH");
const sparseRaydiumNode = raydiumTickNodes.find((node) => node.role === "tick-array-lower")!;
const absentRaydiumRpc = decodeMimirBetaCaptureRpcAccount(sparseRaydiumNode.address, null);
assert.deepEqual(absentRaydiumRpc, { address: sparseRaydiumNode.address, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID,
  executable: false, lamports: 0n, data: new Uint8Array() });
const absentRaydiumCandidate = await decodeMimirBetaCaptureCandidate({ ...sparseRaydium.input,
  accounts: sparseRaydium.input.accounts.map((row) => row.address === sparseRaydiumNode.address ? {
    address: absentRaydiumRpc.address, owner: absentRaydiumRpc.owner, executable: absentRaydiumRpc.executable, data: absentRaydiumRpc.data,
  } : row) });
assert.equal(absentRaydiumCandidate.minDepthTo50BpsNative, initializedRaydium.minDepthTo50BpsNative);
assert.throws(() => decodeMimirBetaCaptureRpcAccount(sparseRaydiumNode.address, undefined),
  (error) => (error as { code?: string }).code === "ACCOUNT_MALFORMED");
const presentRaydiumRow = sparseRaydium.input.accounts.find((row) => row.address === sparseRaydiumNode.address)!;
assert.deepEqual(decodeMimirBetaCaptureRpcAccount(sparseRaydiumNode.address, {
  owner: presentRaydiumRow.owner, executable: presentRaydiumRow.executable, lamports: 123,
  data: [Buffer.from(presentRaydiumRow.data).toString("base64"), "base64"],
}), { address: sparseRaydiumNode.address, owner: presentRaydiumRow.owner, executable: presentRaydiumRow.executable,
  lamports: 123n, data: presentRaydiumRow.data });
assert.throws(() => decodeMimirBetaCaptureRpcAccount(sparseRaydiumNode.address, {
  owner: "bad-address", executable: presentRaydiumRow.executable, lamports: 123,
  data: [Buffer.from(presentRaydiumRow.data).toString("base64"), "base64"],
}), (error) => (error as { code?: string }).code === "ACCOUNT_MALFORMED");
const sparseRaydiumCandidate = await decodeMimirBetaCaptureCandidate(sparseRaydiumRows(sparseRaydium.input, [sparseRaydiumNode]));
assert.equal(sparseRaydiumCandidate.minDepthTo50BpsNative, initializedRaydium.minDepthTo50BpsNative);
const sparseEvidence = sparseRaydiumCandidate.capacityEvidence.find((row) => row.address === sparseRaydiumNode.address)!;
assert.equal(sparseEvidence.owner, MIMIR_BETA_SYSTEM_PROGRAM_ID);
assert.equal(sparseEvidence.dataHash, createHash("sha256").digest("hex"));
const allSparseRaydium = await decodeMimirBetaCaptureCandidate(sparseRaydiumRows(sparseRaydium.input, raydiumTickNodes));
assert.equal(allSparseRaydium.minDepthTo50BpsNative, initializedRaydium.minDepthTo50BpsNative);

const sparseRaydiumPool = {
  eligibility: "eligible" as const,
  family: initializedRaydium.family,
  programId: initializedRaydium.programId,
  pool: initializedRaydium.pool,
  descriptorId: initializedRaydium.descriptorId,
  descriptorHash: initializedRaydium.descriptorHash,
  readPlan: sparseRaydium.input.expectedPlan,
  canonicalMint0: initializedRaydium.canonicalMint0,
  canonicalMint1: initializedRaydium.canonicalMint1,
  canonicalPairKey: initializedRaydium.canonicalPairKey,
  direction: initializedRaydium.direction,
  baseMint: initializedRaydium.baseMint,
  quoteMint: initializedRaydium.quoteMint,
  baseVault: initializedRaydium.baseVault,
  quoteVault: initializedRaydium.quoteVault,
  adapterVersion: initializedRaydium.adapterVersion,
  token2022Mint: initializedRaydium.token2022Mint,
  token2022PolicyHash: initializedRaydium.token2022PolicyHash,
  minLiquidityNative: initializedRaydium.minLiquidityNative,
  minDepthTo50BpsNative: initializedRaydium.minDepthTo50BpsNative,
  observedSlot: sparseRaydium.input.expectedPlan.context.observedSlot,
  validThroughSlot: sparseRaydium.input.expectedPlan.context.observedSlot + 100n,
  evidenceHash: "0".repeat(64),
  creation: buildMimirBetaPoolCreationBinding(initializedRaydium),
};
const liveRows = new Map<Address, MimirBetaAccount | null>(sparseRaydium.input.accounts.map((row) =>
  [row.address, { ...row, lamports: 1n }]));
const presentAdapterAccounts = await freshAdapterAccounts(sparseRaydiumPool, liveRows, true);
const sparseLiveRows = new Map(liveRows);
for (const node of raydiumTickNodes) sparseLiveRows.set(node.address, null);
assert.deepEqual(await freshAdapterAccounts(sparseRaydiumPool, sparseLiveRows, true), presentAdapterAccounts);
const missingTickRows = new Map(sparseLiveRows);
missingTickRows.delete(raydiumTickNodes[0]!.address);
await assert.rejects(() => freshAdapterAccounts(sparseRaydiumPool, missingTickRows, true),
  (error) => (error as { code?: string }).code === "PLAN_STALE");
const missingPoolRows = new Map(liveRows);
missingPoolRows.set(sparseRaydiumPool.pool, null);
await assert.rejects(() => freshAdapterAccounts(sparseRaydiumPool, missingPoolRows, true),
  (error) => (error as { code?: string }).code === "PLAN_STALE");
const fakeAbsentRows = new Map(sparseLiveRows);
fakeAbsentRows.set(sparseRaydiumNode.address, { ...liveRows.get(sparseRaydiumNode.address)!,
  owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: Uint8Array.of(1) });
await assert.rejects(() => freshAdapterAccounts(sparseRaydiumPool, fakeAbsentRows, true),
  (error) => (error as { code?: string }).code === "ACCOUNT_OWNER_MISMATCH");

const activeRaydiumNode = raydiumTickNodes.find((node) => node.role === "tick-array-active")!;
const crossingRaydiumInput = replaceRow(sparseRaydium, activeRaydiumNode.address, (row) => {
  const data = row.data.slice(); const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setInt32(44, 0, true); view.setBigInt64(48, 100_000_000_000n, true); view.setBigUint64(64, 1n, true);
  return { ...row, data };
});
const initializedCrossingRaydium = await decodeMimirBetaCaptureCandidate(crossingRaydiumInput);
assert(initializedCrossingRaydium.minDepthTo50BpsNative < initializedRaydium.minDepthTo50BpsNative);
const sparseMixedRaydium = await decodeMimirBetaCaptureCandidate(sparseRaydiumRows(crossingRaydiumInput,
  raydiumTickNodes.filter((node) => node.role !== "tick-array-active")));
assert.equal(sparseMixedRaydium.minDepthTo50BpsNative, initializedCrossingRaydium.minDepthTo50BpsNative);

await rejects(replaceRow(sparseRaydium, sparseRaydiumNode.address, (row) => ({ ...row, owner: fixtureAddress(244) })), ["ACCOUNT_OWNER_MISMATCH"]);
await rejects(replaceRow(sparseRaydium, sparseRaydiumNode.address, (row) => ({ ...row, executable: true, data: new Uint8Array() })), ["ACCOUNT_MALFORMED"]);
await rejects(replaceRow(sparseRaydium, sparseRaydiumNode.address, (row) => ({
  ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: Uint8Array.of(1),
})), ["ACCOUNT_OWNER_MISMATCH"]);
await rejects(replaceRow(sparseRaydium, sparseRaydiumNode.address, (row) => ({ ...row, owner: sparseRaydium.input.descriptor.programId, data: new Uint8Array() })), ["ACCOUNT_MALFORMED"]);
await rejects({ ...sparseRaydium.input, accounts: sparseRaydium.input.accounts.filter((row) => row.address !== sparseRaydiumNode.address) }, ["CAPTURE_PLAN_MISMATCH"]);
await rejects({ ...sparseRaydium.input, accounts: sparseRaydium.input.accounts.map((row) => row.address === sparseRaydiumNode.address ?
  { ...row, address: fixtureAddress(245) } : row) }, ["CAPTURE_PLAN_MISMATCH"]);

const orcaTickRoles = ["tick-array-lower", "tick-array-active", "tick-array-upper"] as const;
for (const [currentTick, reverseStorage] of [[0, false], [0, true], [-89, false], [-89, true]] as const) {
  const raw = await makeBetaCaptureFixture("orca-whirlpool", { seed: 160 + Math.abs(currentTick) + Number(reverseStorage), currentTick, reverseStorage });
  const primary = { ...poolRow(raw), data: poolRow(raw).data.slice() };
  const sqrt = orcaSqrtPriceX64FromTickIndex(currentTick); for (let i = 0; i < 16; i += 1) primary.data[65 + i] = Number((sqrt >> BigInt(8 * i)) & 0xffn);
  const fixture = { ...raw, input: { ...raw.input, expectedPlan: planFor(raw, raw.input.pair, primary),
    accounts: raw.input.accounts.map((row) => row.address === primary.address ? primary : row) } };
  const nodes = fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-"));
  if (currentTick < 0) assert.ok(nodes.every((node) => Number(node.index) < 0));
  const sparseRows = (input: MimirBetaCaptureCandidateInput, sparse: typeof nodes) => ({ ...input, accounts: input.accounts.map((row) =>
    sparse.some((node) => node.address === row.address) ? { ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, data: new Uint8Array() } : row) });
  const initialized = await decodeMimirBetaCaptureCandidate(fixture.input);
  assert.ok(initialized.minDepthTo50BpsNative > 0n);
  const dynamicRows = { ...fixture.input, accounts: fixture.input.accounts.map((row) => {
    const node = nodes.find((entry) => entry.address === row.address); if (!node) return row;
    const data = new Uint8Array(148); data.set([17, 216, 246, 142, 225, 199, 218, 56]);
    new DataView(data.buffer).setInt32(8, Number(node.index), true); data.set(addressBytes(fixture.input.expectedPlan.pool), 12);
    return { ...row, data };
  }) };
  assert.equal((await decodeMimirBetaCaptureCandidate(dynamicRows)).minDepthTo50BpsNative, initialized.minDepthTo50BpsNative);
  for (const role of orcaTickRoles) {
    const node = nodes.find((entry) => entry.role === role)!;
    assert.equal((await decodeMimirBetaCaptureCandidate(sparseRows(fixture.input, [node]))).minDepthTo50BpsNative, initialized.minDepthTo50BpsNative, role);
    assert.equal((await decodeMimirBetaCaptureCandidate(sparseRows(dynamicRows, [node]))).minDepthTo50BpsNative, initialized.minDepthTo50BpsNative, role);
    const absent = decodeMimirBetaCaptureRpcAccount(node.address, null);
    assert.equal((await decodeMimirBetaCaptureCandidate({ ...fixture.input, accounts: fixture.input.accounts.map((row) => row.address === node.address
      ? { address: absent.address, owner: absent.owner, executable: absent.executable, data: absent.data } : row) })).minDepthTo50BpsNative, initialized.minDepthTo50BpsNative);
    await rejects(replaceRow(fixture, node.address, (row) => ({ ...row, owner: fixtureAddress(244) })), ["ACCOUNT_OWNER_MISMATCH"]);
    await rejects(replaceRow(fixture, node.address, (row) => ({ ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: Uint8Array.of(1) })), ["ACCOUNT_OWNER_MISMATCH"]);
    await rejects(replaceRow(fixture, node.address, (row) => ({ ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: true, data: new Uint8Array() })));
    await rejects(replaceRow(fixture, node.address, (row) => ({ ...row, data: new Uint8Array() })), ["POOL_INELIGIBLE"]);
    await rejects(replaceRow(fixture, node.address, (row) => { const data = row.data.slice(); new DataView(data.buffer).setInt32(8, Number(node.index) + 88, true); return { ...row, data }; }), ["POOL_INELIGIBLE"]);
    await rejects({ ...fixture.input, accounts: fixture.input.accounts.filter((row) => row.address !== node.address) }, ["CAPTURE_PLAN_MISMATCH"]);
    await rejects({ ...fixture.input, accounts: fixture.input.accounts.map((row) => row.address === node.address
      ? { ...row, address: fixtureAddress(245), owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: new Uint8Array() } : row) }, ["CAPTURE_PLAN_MISMATCH"]);
  }
  assert.equal((await decodeMimirBetaCaptureCandidate(sparseRows(fixture.input, nodes))).minDepthTo50BpsNative, initialized.minDepthTo50BpsNative);
}
{
  const fixture = await makeBetaCaptureFixture("orca-whirlpool", { seed: 170, currentTick: 0 });
  const nodes = fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-"));
  const active = nodes.find((node) => node.role === "tick-array-active")!;
  const crossing = replaceRow(fixture, active.address, (row) => {
    const data = row.data.slice(); const offset = 12 + 10 * 113; data[offset] = 1;
    const view = new DataView(data.buffer); view.setBigInt64(offset + 1, -100_000_000_000n, true); view.setBigInt64(offset + 9, -1n, true);
    return { ...row, data };
  });
  const initializedCrossing = await decodeMimirBetaCaptureCandidate(crossing);
  assert(initializedCrossing.minDepthTo50BpsNative < (await decodeMimirBetaCaptureCandidate(fixture.input)).minDepthTo50BpsNative);
  const sparseOthers = { ...crossing, accounts: crossing.accounts.map((row) => nodes.some((node) => node.address === row.address && node !== active)
    ? { ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, data: new Uint8Array() } : row) };
  assert.equal((await decodeMimirBetaCaptureCandidate(sparseOthers)).minDepthTo50BpsNative, initializedCrossing.minDepthTo50BpsNative);
  const orcaPool = { ...sparseRaydiumPool, creation: fixture.creation, readPlan: fixture.input.expectedPlan, pool: fixture.input.expectedPlan.pool,
    descriptorId: fixture.input.descriptor.descriptorId, descriptorHash: fixture.input.descriptor.descriptorHash,
    baseMint: fixture.input.pair.baseMint, quoteMint: fixture.input.pair.quoteMint };
  const rows = new Map<Address, MimirBetaAccount | null>(fixture.input.accounts.map((row) => [row.address, { ...row, lamports: 1n }]));
  const present = await freshAdapterAccounts(orcaPool, rows, true);
  {
    const adaptive = await makeBetaCaptureFixture("orca-whirlpool", { seed: 170, currentTick: 0, orcaTradeEnableTimestamp: 0n });
    const arows = new Map<Address, MimirBetaAccount | null>(adaptive.input.accounts.map((row) => [row.address, { ...row, lamports: 1n }]));
    assert.deepEqual(await freshAdapterAccounts({ ...orcaPool, readPlan: adaptive.input.expectedPlan }, arows, false), present, "adaptive Oracle stays out of the refresh vector");
  }
  for (const node of nodes) {
    const sparse = new Map(rows); sparse.set(node.address, null);
    assert.deepEqual(await freshAdapterAccounts(orcaPool, sparse, true), present);
    assert.deepEqual(await freshAdapterAccounts(orcaPool, sparse, false), present);
    const missing = new Map(rows); missing.delete(node.address);
    await assert.rejects(() => freshAdapterAccounts(orcaPool, missing, true), (error) => (error as { code?: string }).code === "PLAN_STALE");
    const fake = new Map(rows); fake.set(node.address, { ...rows.get(node.address)!, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, data: Uint8Array.of(1) });
    await assert.rejects(() => freshAdapterAccounts(orcaPool, fake, false), (error) => (error as { code?: string }).code === "ACCOUNT_OWNER_MISMATCH");
  }
  const allSparse = new Map(rows); for (const node of nodes) allSparse.set(node.address, null);
  assert.deepEqual(await freshAdapterAccounts(orcaPool, allSparse, true), present);
  for (const role of ["pool", "whirlpools-config"] as const) {
    const address = role === "pool" ? orcaPool.pool : fixture.input.expectedPlan.auxiliary.find((node) => node.role === role)!.address;
    const nulled = new Map(rows); nulled.set(address, null);
    await assert.rejects(() => freshAdapterAccounts(orcaPool, nulled, true), (error) => (error as { code?: string }).code === "PLAN_STALE");
  }
}

{
  const ZERO_GAP_CONTROL_DEPTH = 2_496_882_788n; const ZERO_GAP_HALF_DEPTH = 1_248_441_394n;
  const L = 1_000_000_000_000n;
  const putI128 = (data: Uint8Array, offset: number, value: bigint) => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength); const raw = BigInt.asUintN(128, value);
    view.setBigUint64(offset, raw & ((1n << 64n) - 1n), true); view.setBigUint64(offset + 8, raw >> 64n, true);
  };
  const withNets = (fixture: BetaCaptureFixture, nets: Readonly<Record<number, bigint>>, layout: "fixed" | "dynamic" | "raydium", sparse = false) => {
    const span = layout === "raydium" ? 60 : 88;
    const nodes = fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-"));
    return { ...fixture.input, accounts: fixture.input.accounts.map((row) => {
      const node = nodes.find((entry) => entry.address === row.address); if (!node) return row;
      const start = Number(node.index);
      const ticks = Object.keys(nets).map(Number).filter((tick) => tick >= start && tick < start + span);
      if (ticks.length === 0 && sparse) return { ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, data: new Uint8Array() };
      if (layout === "raydium") {
        const data = row.data.slice();
        for (const tick of ticks) {
          const offset = 44 + (tick - start) * 168; new DataView(data.buffer).setInt32(offset, tick, true);
          putI128(data, offset + 4, nets[tick]!); putI128(data, offset + 20, nets[tick]! < 0n ? -nets[tick]! : nets[tick]!);
        }
        return { ...row, data };
      }
      if (layout === "fixed") {
        const data = row.data.slice();
        for (const tick of ticks) { const offset = 12 + (tick - start) * 113; data[offset] = 1; putI128(data, offset + 1, nets[tick]!); }
        return { ...row, data };
      }
      const indexes = ticks.map((tick) => tick - start).sort((a, b) => a - b);
      const data = new Uint8Array(60 + 88 + indexes.length * 112); data.set([17, 216, 246, 142, 225, 199, 218, 56]);
      new DataView(data.buffer).setInt32(8, start, true); data.set(addressBytes(fixture.input.expectedPlan.pool), 12);
      putI128(data, 44, indexes.reduce((bitmap, index) => bitmap | (1n << BigInt(index)), 0n));
      let offset = 60;
      for (let index = 0; index < 88; index += 1) {
        if (!indexes.includes(index)) { offset += 1; continue; }
        data[offset] = 1; putI128(data, offset + 1, nets[start + index]!); offset += 113;
      }
      return { ...row, data };
    }) };
  };
  const gapShapes: Readonly<Record<string, Readonly<Record<number, bigint>>>> = {
    down: { [-10]: L, [-20]: -2n * L, [-40]: 2n * L },
    up: { 10: -L },
    both: { [-40]: 2n * L, [-20]: -2n * L, [-10]: L, 10: -L },
  };
  const invalidShapes: Readonly<Record<string, Readonly<Record<number, bigint>>>> = {
    negativeDown: { [-10]: 2n * L },
    negativeUp: { 10: -2n * L },
    negativeAfterZeroDown: { [-10]: L, [-20]: 1n },
    negativeAfterZeroUp: { 10: -L, 20: -1n },
    overflowAfterZero: { 10: -L, 20: (1n << 127n) - 1n, 30: 1n },
  };
  for (const [family, layouts] of [["orca-whirlpool", ["fixed", "dynamic"]], ["raydium-clmm", ["raydium"]]] as const) {
    for (const reverseStorage of [false, true]) {
      const fixture = await makeBetaCaptureFixture(family, { seed: 171 + Number(reverseStorage), reverseStorage });
      const baseline = await decodeMimirBetaCaptureCandidate(fixture.input);
      assert.equal(baseline.minDepthTo50BpsNative, ZERO_GAP_CONTROL_DEPTH); assert.equal(baseline.conditions, undefined);
      for (const layout of layouts) {
        for (const sparse of [false, true]) {
          const control = await decodeMimirBetaCaptureCandidate(withNets(fixture, { [-10]: L / 2n, 10: -L / 2n }, layout, sparse));
          assert.equal(control.minDepthTo50BpsNative, ZERO_GAP_HALF_DEPTH); assert.equal(control.conditions, undefined);
          for (const [shape, nets] of Object.entries(gapShapes)) {
            const gap = await decodeMimirBetaCaptureCandidate(withNets(fixture, nets, layout, sparse));
            assert.equal(gap.minDepthTo50BpsNative, 0n, `${family} ${layout} ${shape}`); assert.equal(gap.minLiquidityNative, 0n);
            assert.equal(gap.conditions, MIMIR_COND.DEPTH_BELOW_FLOOR, `${family} ${layout} ${shape}`);
          }
          for (const [shape, nets] of Object.entries(invalidShapes)) {
            await assert.rejects(() => decodeMimirBetaCaptureCandidate(withNets(fixture, nets, layout, sparse)),
              (error) => (error as { code?: string }).code === "POOL_INELIGIBLE", `${family} ${layout} ${shape}`);
          }
        }
      }
    }
    const empty = await makeBetaCaptureFixture(family, { seed: 186, curveLiquidity: 0n });
    const emptyCandidate = await decodeMimirBetaCaptureCandidate(empty.input);
    assert.equal(emptyCandidate.minDepthTo50BpsNative, 0n); assert.equal(emptyCandidate.conditions, MIMIR_COND.DEPTH_BELOW_FLOOR);
    for (const dust of [1n, 100n]) {
      const c = await decodeMimirBetaCaptureCandidate((await makeBetaCaptureFixture(family, { seed: 186, curveLiquidity: dust })).input);
      assert.equal(c.minDepthTo50BpsNative, 0n, `${family} dust ${dust}`); assert.equal(c.conditions, MIMIR_COND.DEPTH_BELOW_FLOOR);
    }
    for (const [shape, nets] of Object.entries({ coherent: { 10: L, 20: -L, [-10]: -L, [-20]: L } })) {
      const zero = await decodeMimirBetaCaptureCandidate(withNets(empty, nets, layouts[0]));
      assert.equal(zero.minDepthTo50BpsNative, 0n, `${family} empty ${shape}`); assert.equal(zero.conditions, MIMIR_COND.DEPTH_BELOW_FLOOR);
    }
    for (const initial of [0n, 1n]) {
      const fixture = initial === 0n ? empty : await makeBetaCaptureFixture(family, { seed: 186, curveLiquidity: initial });
      for (const [shape, nets] of Object.entries({ negativeUp: { 10: -2n }, negativeDown: { [-10]: 2n },
        overflowUp: { 10: (1n << 127n) - 1n, 20: 1n }, overflowDown: { [-10]: -((1n << 127n) - 1n), [-20]: -1n } } as Readonly<Record<string, Readonly<Record<number, bigint>>>>)) {
        await assert.rejects(() => decodeMimirBetaCaptureCandidate(withNets(fixture, nets, layouts[0])),
          (error) => (error as { code?: string }).code === "POOL_INELIGIBLE", `${family} initial ${initial} ${shape}`);
      }
    }
  }
  const raydium = await makeBetaCaptureFixture("raydium-clmm", { seed: 187 });
  const mismatched = withNets(raydium, { [-10]: L }, "raydium");
  const lower = raydium.input.expectedPlan.auxiliary.find((node) => node.role === "tick-array-lower")!;
  const lowerRow = mismatched.accounts.find((row) => row.address === lower.address)!;
  const badTick = lowerRow.data.slice(); new DataView(badTick.buffer).setInt32(44 + 50 * 168, -9, true);
  await rejects({ ...mismatched, accounts: mismatched.accounts.map((row) => row === lowerRow ? { ...row, data: badTick } : row) }, ["POOL_INELIGIBLE"]);
}

const outOfBitmapFixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 203 });
const outOfBitmapTick = 30_779;
const outOfBitmapPoolData = poolRow(outOfBitmapFixture).data.slice();
const outOfBitmapView = new DataView(outOfBitmapPoolData.buffer, outOfBitmapPoolData.byteOffset, outOfBitmapPoolData.byteLength);
outOfBitmapView.setInt32(269, outOfBitmapTick, true);
const outOfBitmapPool = { ...poolRow(outOfBitmapFixture), data: outOfBitmapPoolData };
const outOfBitmapPlan = planFor(outOfBitmapFixture, outOfBitmapFixture.input.pair, outOfBitmapPool);
assert.deepEqual(outOfBitmapPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-")).map((node) => Number(node.index)),
  [30_660, 30_720, 30_780]);

const cpmmFixture = await makeBetaCaptureFixture("raydium-cpmm", { seed: 637, cpmmAllocation: 637 });
assert.deepEqual(new Set(cpmmFixture.input.expectedPlan.auxiliary.map((node) => node.role)),
  new Set(["base-mint", "quote-mint", "base-vault", "quote-vault", "amm-config", "cpmm-observation"]));
await decodeMimirBetaCaptureCandidate(cpmmFixture.input);
assert.throws(() => planFor(cpmmFixture, cpmmFixture.input.pair, {
  ...poolRow(cpmmFixture), data: new Uint8Array(741),
}), (error) => (error as { code?: string }).code === "UNKNOWN_CAPTURE_ALLOCATION");
const cpmm = await makeBetaCaptureFixture("raydium-cpmm", { seed: 199 });
const wrongObservation = { ...poolRow(cpmm), data: poolRow(cpmm).data.slice() };
wrongObservation.data.set(addressBytes(fixtureAddress(244)), 296);
assert.throws(() => planFor(cpmm, cpmm.input.pair, wrongObservation),
  (error) => ["PDA_MISMATCH", "INCOMPLETE_CAPTURE_DESCRIPTOR"].includes((error as { code?: string }).code ?? ""));

for (const family of ["raydium-amm-v4", "pumpswap"] as const) {
  const fixture = await makeBetaCaptureFixture(family, { seed: family === "raydium-amm-v4" ? 33 : 93, baseDecimals: 3, quoteDecimals: 8 });
  const inversePair = { baseMint: fixture.input.pair.quoteMint, quoteMint: fixture.input.pair.baseMint };
  const inversePlan = planFor(fixture, inversePair);
  const inverse = await decodeMimirBetaCaptureCandidate({ ...fixture.input, pair: inversePair, expectedPlan: inversePlan });
  const direct = await decodeMimirBetaCaptureCandidate(fixture.input);
  assert.equal(inverse.baseVault, direct.quoteVault); assert.equal(inverse.quoteVault, direct.baseVault);
  assert.equal(inverse.minLiquidityNative, direct.minLiquidityNative);
}

const ammV4 = await makeBetaCaptureFixture("raydium-amm-v4", { seed: 34 });
const ammPositive = await decodeMimirBetaCaptureCandidate(ammV4.input);
assert.equal(ammPositive.pointOnly, undefined);
const ammZeroFee = await decodeMimirBetaCaptureCandidate(replaceRow(ammV4, ammV4.input.expectedPlan.pool, (row) => {
  const data = row.data.slice(); new DataView(data.buffer).setBigUint64(176, 0n, true); return { ...row, data };
}));
assert.equal(ammZeroFee.pointOnly, true);
for (const [numerator, pointOnly] of [[1n, true], [5000n, undefined]] as const) {
  const candidate = await decodeMimirBetaCaptureCandidate(replaceRow(ammV4, ammV4.input.expectedPlan.pool, (row) => {
    const data = row.data.slice(); const view = new DataView(data.buffer);
    view.setBigUint64(176, numerator, true); view.setBigUint64(184, 2_000_000n, true); return { ...row, data };
  }));
  assert.equal(candidate.pointOnly, pointOnly);
}
const ammTradeFeeOnly = await decodeMimirBetaCaptureCandidate(replaceRow(ammV4, ammV4.input.expectedPlan.pool, (row) => {
  const data = row.data.slice(); const view = new DataView(data.buffer);
  view.setBigUint64(144, 5000n, true); view.setBigUint64(152, 10_000n, true); view.setBigUint64(176, 0n, true); return { ...row, data };
}));
assert.equal(ammTradeFeeOnly.pointOnly, true);
assert.notEqual(ammZeroFee.capacityHash, ammPositive.capacityHash);
const ammDust = await makeBetaCaptureFixture("raydium-amm-v4", { seed: 34, baseAmount: 1_000_000n, quoteAmount: 1_000_000n, baseDecimals: 6, quoteDecimals: 6 });
const ammDustOnePpm = await decodeMimirBetaCaptureCandidate(replaceRow(ammDust, ammDust.input.expectedPlan.pool, (row) => {
  const data = row.data.slice(); const view = new DataView(data.buffer);
  view.setBigUint64(144, 25n, true); view.setBigUint64(152, 10_000n, true); view.setBigUint64(176, 1n, true); view.setBigUint64(184, 1_000_000n, true);
  return { ...row, data };
}));
assert.equal(ammDustOnePpm.minDepthTo50BpsNative, 2496n);
assert.equal(ammDustOnePpm.pointOnly, true);
const ammProgram = ammV4.fixtureAccounts.find((row) => row.fixtureRole === "market-program")!;
const ammAdministrativeOwner = "GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ" as Address;
await rejects(replaceRow(ammV4, ammProgram.address, (row) => ({ ...row, executable: false })), ["ACCOUNT_MALFORMED"]);
await rejects(replaceRow(ammV4, ammV4.input.expectedPlan.pool, (row) => {
  const data = row.data.slice(); data.set(addressBytes(fixtureAddress(246)), 688); return { ...row, data };
}), ["POOL_INELIGIBLE"]);
for (const role of ["base-vault", "quote-vault"] as const) {
  const vault = ammV4.fixtureAccounts.find((row) => row.fixtureRole === role)!;
  await rejects(replaceRow(ammV4, vault.address, (row) => {
    const data = row.data.slice(); data.set(addressBytes(ammAdministrativeOwner), 32); return { ...row, data };
  }), ["POOL_INELIGIBLE"]);
}
const ammUnderflow = replaceRow(ammV4, ammV4.input.expectedPlan.pool, (row) => {
  const data = row.data.slice(); new DataView(data.buffer).setBigUint64(192, 2_000_001n, true); return { ...row, data };
});
await rejects(ammUnderflow, ["POOL_INELIGIBLE"]);
const liveOpenPrimary = { ...poolRow(ammV4), data: poolRow(ammV4).data.slice() }; const liveOpenAddress = fixtureAddress(247);
liveOpenPrimary.data.set(addressBytes(liveOpenAddress), 496);
const liveOpenPlan = planFor(ammV4, ammV4.input.pair, liveOpenPrimary);
const market = ammV4.fixtureAccounts.find((row) => row.fixtureRole === "market")!.address;
const openData = new Uint8Array(3_228); openData.set(addressBytes(market), 13);
openData.set(addressBytes(ammV4.creation.vaultAuthority), 45);
new DataView(openData.buffer).setBigUint64(85, 100n, true); new DataView(openData.buffer).setBigUint64(101, 200n, true);
const liveOpenAccounts = ammV4.input.accounts.filter((row) => row.address !== "11111111111111111111111111111111" && row.address !== ammV4.input.expectedPlan.pool);
liveOpenAccounts.push(liveOpenPrimary, { address: liveOpenAddress, owner: ammProgram.address, executable: false, data: openData });
const liveOpen = await decodeMimirBetaCaptureCandidate({ ...ammV4.input, expectedPlan: liveOpenPlan, accounts: liveOpenAccounts });
assert.equal(liveOpen.vaultAuthority, "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1");
assert.equal(liveOpen.minLiquidityNative, (await decodeMimirBetaCaptureCandidate(ammV4.input)).minLiquidityNative + 100n);
await rejects({ ...ammV4.input, expectedPlan: liveOpenPlan, accounts: liveOpenAccounts.map((row) => row.address === liveOpenAddress ?
  { ...row, data: (() => { const bytes = row.data.slice(); bytes.set(addressBytes(ammAdministrativeOwner), 45); return bytes; })() } : row) }, ["POOL_INELIGIBLE"]);
await rejects({ ...ammV4.input, expectedPlan: liveOpenPlan, accounts: liveOpenAccounts.map((row) => row.address === liveOpenAddress ?
  { ...row, data: (() => { const bytes = row.data.slice(); bytes[13] ^= 1; return bytes; })() } : row) }, ["POOL_INELIGIBLE"]);

const pump = await makeBetaCaptureFixture("pumpswap", { seed: 94 });
const pumpBase = await decodeMimirBetaCaptureCandidate(pump.input);
for (const [poolOffset, globalOffset] of [[243, 417], [244, 642]] as const) {
  const primary = { ...poolRow(pump), data: poolRow(pump).data.slice() }; primary.data[poolOffset] = 1;
  const input = replaceRow(pump, pump.input.expectedPlan.pool, () => primary);
  const changed = replaceRow({ ...pump, input }, pump.fixtureAccounts.find((row) => row.fixtureRole === "global-config")!.address,
    (row) => { const data = row.data.slice(); data[globalOffset] = 0; return { ...row, data }; });
  const decoded = await decodeMimirBetaCaptureCandidate({ ...changed, expectedPlan: planFor(pump, pump.input.pair, primary) });
  assert.equal(decoded.minLiquidityNative, pumpBase.minLiquidityNative);
  assert.equal(decoded.minDepthTo50BpsNative, pumpBase.minDepthTo50BpsNative);
  assert.equal(compareMimirBetaCaptureCandidates(decoded, pumpBase), 0);
}
for (const virtual of [-1_000_000n, 0n, 1_000_000n]) {
  const changed = replaceRow(pump, pump.input.expectedPlan.pool, (row) => {
    const data = row.data.slice(); const encoded = BigInt.asUintN(128, virtual);
    new DataView(data.buffer).setBigUint64(245, encoded & ((1n << 64n) - 1n), true);
    new DataView(data.buffer).setBigUint64(253, encoded >> 64n, true); return { ...row, data };
  });
  const decoded = await decodeMimirBetaCaptureCandidate(changed);
  assert.equal(decoded.minLiquidityNative, pumpBase.minLiquidityNative); assert.equal(decoded.minDepthTo50BpsNative, pumpBase.minDepthTo50BpsNative);
}
{
  const withPending = (protocol: bigint, creator: bigint) => replaceRow(pump, pump.input.expectedPlan.pool, (row) => {
    const data = row.data.slice(); new DataView(data.buffer).setBigUint64(271, protocol, true); new DataView(data.buffer).setBigUint64(279, creator, true); return { ...row, data };
  });
  const pending = await decodeMimirBetaCaptureCandidate(withPending(1_000n, 2_000n));
  assert.ok(pending.minDepthTo50BpsNative <= pumpBase.minDepthTo50BpsNative, "pending Pump fees are not executable depth");
  await rejects(withPending(1n << 62n, 1n << 62n), ["POOL_INELIGIBLE"]);
}
{
  const pump287 = mimirBetaCaptureScanDescriptors().find((descriptor) => descriptor.descriptorId === "pumpswap-287-v1")!;
  const realRows = PUMPSWAP_REAL_287_ACCOUNTS.map((row) => ({ address: address(row.address), owner: address(row.owner), executable: false, data: Uint8Array.from(row.data) }));
  const primary = realRows[0]!;
  const pair = { baseMint: bytesAddress(primary.data.subarray(43, 75)), quoteMint: bytesAddress(primary.data.subarray(75, 107)) };
  const plan = deriveMimirBetaCaptureReadPlan({ descriptor: pump287, primary, pair, context: pump.input.context });
  const feeConfig = plan.auxiliary.find((node) => node.role === "fee-config")!.address;
  const fixtureFeeConfig = pump.fixtureAccounts.find((row) => row.fixtureRole === "fee-config")!;
  const accounts = plan.allAddresses.map((key) => key === feeConfig ? { ...fixtureFeeConfig, address: feeConfig } : realRows.find((row) => row.address === key)!);
  const decoded = await decodeMimirBetaCaptureCandidate({ descriptor: pump287, pair, context: pump.input.context, expectedPlan: plan, accounts });
  assert.deepEqual([decoded.pool, decoded.descriptorId, decoded.adapterVersion], [PUMPSWAP_REAL_287_POOL.address, "pumpswap-287-v1", 1]);
  assert.ok(decoded.minDepthTo50BpsNative > 0n, "a real 287-byte migrate_v2 pool decodes with its missing tail read as zero");
  const short = { ...poolRow(pump), data: poolRow(pump).data.slice(0, 288) };
  for (const descriptor of mimirBetaCaptureScanDescriptors().filter((candidate) => candidate.family === "pumpswap")) {
    assert.throws(() => deriveMimirBetaCaptureReadPlan({ descriptor, primary: short, pair: pump.input.pair, context: pump.input.context }),
      (error) => (error as { code?: string }).code === "UNKNOWN_CAPTURE_ALLOCATION");
  }
}
{
  assert.equal(deriveMimirBetaPumpSwapBoostVault(address("4EKog93LDJpfFmmr12gnw2j8aynbZad9Qkcfu7jUaCnJ"), address("So11111111111111111111111111111111111111112"),
    MIMIR_BETA_SPL_TOKEN_PROGRAM_ID), "2LA8xsyHeHCnVRP5AExYi2msHXtZvZvjmDWDdp1669ht");
  const t22Pool = address("4EKog93LDJpfFmmr12gnw2j8aynbZad9Qkcfu7jUaCnJ"), t22Mint = address("2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo");
  const boostOwner = PublicKey.findProgramAddressSync([Buffer.from("boost_vault"), addressBytes(t22Pool)], new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"))[0];
  const t22Vault = deriveMimirBetaPumpSwapBoostVault(t22Pool, t22Mint, MIMIR_BETA_TOKEN_2022_PROGRAM_ID);
  assert.equal(t22Vault, PublicKey.findProgramAddressSync([boostOwner.toBytes(), addressBytes(MIMIR_BETA_TOKEN_2022_PROGRAM_ID), addressBytes(t22Mint)],
    new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"))[0].toBase58());
  assert.notEqual(t22Vault, deriveMimirBetaPumpSwapBoostVault(t22Pool, t22Mint, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID));
  assert.equal(pumpBase.boostVaultLamports, undefined);
  const noVault = await decodeMimirBetaCaptureCandidate({ ...pump.input, pumpSwapBoostVault: null });
  assert.deepEqual([noVault.boostVaultLamports, noVault.maxBoostDriftBps, noVault.capacityHash], [0n, 0n, pumpBase.capacityHash]);
  const poolData = poolRow(pump).data, poolQuoteMint = bytesAddress(poolData.subarray(75, 107));
  const vaultAddress = deriveMimirBetaPumpSwapBoostVault(pump.input.expectedPlan.pool, poolQuoteMint, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID);
  const vaultData = new Uint8Array(165); vaultData.set(addressBytes(poolQuoteMint), 0);
  vaultData.set(PublicKey.findProgramAddressSync([Buffer.from("boost_vault"), addressBytes(pump.input.expectedPlan.pool)],
    new PublicKey("pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA"))[0].toBytes(), 32);
  vaultData[108] = 1;
  const quoteRow = pump.input.accounts.find((row) => row.data.length === 165 && bytesAddress(row.data.subarray(0, 32)) === poolQuoteMint)!;
  const quoteAmount = new DataView(quoteRow.data.buffer, quoteRow.data.byteOffset).getBigUint64(64, true);
  new DataView(vaultData.buffer).setBigUint64(64, quoteAmount, true);
  const vault = { address: vaultAddress, owner: MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, executable: false, data: vaultData };
  const boosted = await decodeMimirBetaCaptureCandidate({ ...pump.input, pumpSwapBoostVault: vault });
  assert.deepEqual([boosted.boostVaultLamports, boosted.maxBoostDriftBps], [quoteAmount, 30_000n], "a vault equal to Q_eff discloses (1+1)^2-1");
  await assert.rejects(() => decodeMimirBetaCaptureCandidate({ ...pump.input, pumpSwapBoostVault: { ...vault, address: fixtureAddress(7) } }));
  const bareLamports = await decodeMimirBetaCaptureCandidate({ ...pump.input,
    pumpSwapBoostVault: { address: vaultAddress, owner: address("11111111111111111111111111111111"), executable: false, data: new Uint8Array() } });
  assert.deepEqual([bareLamports.boostVaultLamports, bareLamports.maxBoostDriftBps], [0n, 0n], "a system-owned vault without data is unfunded");
  const withAmount = (amount: bigint) => { const data = vaultData.slice(); new DataView(data.buffer).setBigUint64(64, amount, true); return { ...vault, data }; };
  const grief = await decodeMimirBetaCaptureCandidate({ ...pump.input, pumpSwapBoostVault: withAmount(1n) });
  assert.deepEqual([grief.boostVaultLamports, grief.maxBoostDriftBps! < 50n], [1n, true], "a 1-lamport grief vault stays under the drift limit");
  const poolView = new DataView(poolData.buffer, poolData.byteOffset);
  const effectiveQuote = quoteAmount + (poolView.getBigInt64(253, true) << 64n) + poolView.getBigUint64(245, true);
  const funded = await decodeMimirBetaCaptureCandidate({ ...pump.input, pumpSwapBoostVault: withAmount(11_060_000_000n) });
  assert.equal(funded.maxBoostDriftBps! >= 50n, 11_060_000_000n * (2n * effectiveQuote + 11_060_000_000n) * 10_000n >= 50n * effectiveQuote * effectiveQuote,
    "an 11.06 SOL vault matches the program drift formula");
  assert(funded.maxBoostDriftBps! >= 50n, "an 11.06 SOL vault is refused");
}
{
  const baseMint = bytesAddress(poolRow(pump).data.subarray(43, 75));
  const zeroSupply = replaceRow(pump, baseMint, (row) => { const data = row.data.slice(); new DataView(data.buffer).setBigUint64(36, 0n, true); return { ...row, data }; });
  const refused = await decodeMimirBetaCaptureCandidate(zeroSupply).catch((error: unknown) => error);
  assert.ok(refused instanceof MimirBetaPoolIneligibleError && refused.code === "POOL_INELIGIBLE" && refused.reason === "PUMPSWAP_POOL_BASE_SUPPLY_ZERO");
  assert.match(explainMimirBetaTokenRefusal(refused.code, refused.reason)!, /zero supply/);
}
const pumpGlobal = pump.fixtureAccounts.find((row) => row.fixtureRole === "global-config")!;
for (const offset of [243, 244]) {
  const primary = { ...poolRow(pump), data: poolRow(pump).data.slice() }; primary.data[offset] = 2;
  await rejects({ ...replaceRow(pump, pump.input.expectedPlan.pool, () => primary), expectedPlan: planFor(pump, pump.input.pair, primary) }, ["POOL_INELIGIBLE"]);
}
for (const offset of [417, 642, 939]) {
  await rejects(replaceRow(pump, pumpGlobal.address, (row) => { const data = row.data.slice(); data[offset] = 2; return { ...row, data }; }), ["POOL_INELIGIBLE"]);
}
await rejects(replaceRow(pump, pumpGlobal.address, (row) => { const data = row.data.slice(); data[56] = 0x20; return { ...row, data }; }), ["POOL_INELIGIBLE"]);
await rejects(replaceRow(pump, pumpGlobal.address, (row) => { const data = row.data.slice(); data[56] = 0x18; return { ...row, data }; }), ["POOL_INELIGIBLE"]);
await rejects(replaceRow(pump, pumpGlobal.address, (row) => { const data = row.data.slice(); new DataView(data.buffer).setBigUint64(40, 10_001n, true); return { ...row, data }; }), ["POOL_INELIGIBLE"]);
const pumpFee = pump.fixtureAccounts.find((row) => row.fixtureRole === "fee-config")!;
const paddedPumpFee = (length: number, mutate?: (data: Uint8Array) => void) => replaceRow(pump, pumpFee.address, (row) => {
  const data = new Uint8Array(length); data.set(row.data); mutate?.(data); return { ...row, data };
});
const pumpPadded = await decodeMimirBetaCaptureCandidate(paddedPumpFee(4_073));
assert.equal(compareMimirBetaCaptureCandidates(pumpPadded, pumpBase), 0);
await rejects(paddedPumpFee(4_073, (data) => { data[pumpFee.data.length] = 1; }), ["POOL_INELIGIBLE"]);
await rejects(paddedPumpFee(4_073, (data) => { data[data.length - 1] = 1; }), ["POOL_INELIGIBLE"]);
await rejects(paddedPumpFee(4_072), ["POOL_INELIGIBLE"]);
await rejects(paddedPumpFee(4_074), ["POOL_INELIGIBLE"]);
await rejects(paddedPumpFee(4_097, (data) => { data[data.length - 1] = 1; }), ["POOL_INELIGIBLE"]);
await rejects(paddedPumpFee(4_096), ["POOL_INELIGIBLE"]);
await rejects(replaceRow(pump, pumpFee.address, (row) => ({ ...row, data: Uint8Array.from([...row.data, 0]) })), ["POOL_INELIGIBLE"]);
await rejects(replaceRow(pump, pumpFee.address, (row) => ({ ...row, data: row.data.slice(0, 68) })), ["POOL_INELIGIBLE"]);
await rejects(replaceRow(pump, pumpFee.address, (row) => { const data = row.data.slice(); new DataView(data.buffer).setUint32(65, 33, true); return { ...row, data }; }), ["POOL_INELIGIBLE"]);
await rejects(replaceRow(pump, pumpFee.address, (row) => ({ ...row, owner: fixtureAddress(248) })), ["ACCOUNT_OWNER_MISMATCH"]);

const currentUsdc = await currentPumpInput({
  quoteMint: address(MIMIR_MAINNET_USDC_MINT.toBase58()),
  regular: [{ threshold: 0n, fees: [0n, 0n, 0n] }],
  stable: [{ threshold: 10n, fees: [10n, 0n, 0n] }],
});
assert.equal((await decodeMimirBetaCaptureCandidate(currentUsdc)).pointOnly, undefined);
assert.equal((await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  quoteMint: address(MIMIR_MAINNET_USDC_MINT.toBase58()),
  regular: [{ threshold: 0n, fees: [0n, 0n, 0n] }],
}))).pointOnly, true);
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  regular: [{ threshold: 0n, fees: [0n, 0n, 0n] }],
  stable: [{ threshold: 10n, fees: [0n, 0n, 0n] }],
  exotic: [10n, 0n, 0n],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  flat: [10n, 0n, 0n],
  regular: [{ threshold: 0n, fees: [0n, 0n, 0n] }],
  stable: [{ threshold: 10n, fees: [0n, 0n, 0n] }],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  quoteMint: address(MIMIR_MAINNET_USDC_MINT.toBase58()),
  poolIndex: 1,
  flat: [10n, 0n, 0n],
  regular: [{ threshold: 0n, fees: [0n, 0n, 0n] }],
  stable: [{ threshold: 10n, fees: [0n, 0n, 0n] }],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  quoteMint: address("So11111111111111111111111111111111111111112"),
  regular: [{ threshold: 0n, fees: [10n, 0n, 0n] }],
  stable: [{ threshold: 0n, fees: [0n, 0n, 0n] }],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  quoteMint: address("9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP"),
  regular: [{ threshold: 0n, fees: [10n, 0n, 0n] }],
  stable: [{ threshold: 0n, fees: [0n, 0n, 0n] }],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  quoteMint: address("So11111111111111111111111111111111111111112"),
  mayhem: true,
  regular: [
    { threshold: 0n, fees: [0n, 0n, 0n] },
    { threshold: 1_000_000_000_000n, fees: [10n, 0n, 0n] },
  ],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  creatorFeeEnabled: true,
  maxCreatorFee: 50n,
  poolCreatorFee: 4_000n,
  coinCreator: true,
  exotic: [6_000n, 0n, 4_000n],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  creatorFeeEnabled: true,
  maxCreatorFee: 1n,
  poolCreatorFee: 10_000n,
  coinCreator: true,
  exotic: [0n, 0n, 1n],
}));
await decodeMimirBetaCaptureCandidate(await currentPumpInput({
  creatorFeeEnabled: true,
  poolCreatorFee: 10_000n,
  coinCreator: false,
  exotic: [1n, 0n, 1n],
}));
for (const globalMutation of [
  (data: Uint8Array) => { data[940] = 2; },
  (data: Uint8Array) => { new DataView(data.buffer).setBigUint64(941, 10_001n, true); },
]) {
  const input = await currentPumpInput();
  const globalAddress = input.expectedPlan.auxiliary.find((node) => node.role === "global-config")!.address;
  await rejects(replaceRow({ ...pump, input }, globalAddress, (row) => {
    const data = row.data.slice(); globalMutation(data); return { ...row, data };
  }));
}
const badCanEdit = await currentPumpInput();
const currentPoolRow = badCanEdit.accounts.find((row) => row.address === badCanEdit.expectedPlan.pool)!;
const badPool = { ...currentPoolRow, data: currentPoolRow.data.slice() };
badPool.data[269] = 2;
await rejects({ ...badCanEdit, expectedPlan: planFor(pump, badCanEdit.pair, badPool),
  accounts: badCanEdit.accounts.map((row) => row.address === badPool.address ? badPool : row) });
await rejects(replaceRow(pump, pump.input.pair.baseMint, (row) => ({ ...row, data: Uint8Array.from([...row.data, 0]) })), ["ACCOUNT_MALFORMED"]);
const pumpBadLp = { ...poolRow(pump), data: poolRow(pump).data.slice() }; pumpBadLp.data[107] ^= 1;
assert.throws(() => planFor(pump, pump.input.pair, pumpBadLp), (error) => (error as { code?: string }).code === "PDA_MISMATCH");

for (const [activeId, step, expectedCount] of [[0, 100, 2], [69, 50, 2], [35, 1, 3], [-35, 1, 3]] as const) {
  const fixture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 115 + activeId, activeId, binStep: step });
  assert.equal(fixture.input.expectedPlan.auxiliary.filter((node) => node.role === "depth-bin-array").length, expectedCount);
  if (activeId === 0) await decodeMimirBetaCaptureCandidate(fixture.input);
}
for (const activeId of [62, -62, 35]) {
  const step = activeId === 35 ? 10 : 4; const fixture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 180 + activeId, activeId, binStep: step });
  const activeIndex = Math.floor(activeId / 70); const activeLower = activeIndex * 70; const target = Math.ceil(50 / step);
  const lower = Math.max(activeId - target, activeLower); const upper = Math.min(activeId + target, activeLower + 69);
  const price = meteoraDlmmPriceFromIdX64(activeId, step); const inversePrice = (Q64 * Q64) / price;
  const expectedForward = [BigInt(activeId - lower + 1) * 100n, BigInt(upper - activeId + 1) * 100n * price / Q64];
  const expectedReverse = [BigInt(activeId - lower + 1) * 100n * inversePrice / Q64, BigInt(upper - activeId + 1) * 100n];
  const forward = await decodeMimirBetaCaptureCandidate(fixture.input);
  const reversePair = { baseMint: fixture.input.pair.quoteMint, quoteMint: fixture.input.pair.baseMint };
  const reverse = await decodeMimirBetaCaptureCandidate({ ...fixture.input, pair: reversePair, expectedPlan: planFor(fixture, reversePair) });
  assert.equal(forward.minDepthTo50BpsNative, expectedForward.reduce((a, b) => a < b ? a : b));
  assert.equal(reverse.minDepthTo50BpsNative, expectedReverse.reduce((a, b) => a < b ? a : b));
  const neighbourHeavy = { ...fixture.input, accounts: fixture.input.accounts.map((row) => {
    const node = fixture.input.expectedPlan.auxiliary.find((candidate) => candidate.address === row.address);
    if (node?.role !== "depth-bin-array" || Number(node.index) === activeIndex) return row;
    const data = row.data.slice();
    for (let local = 0; local < 70; local += 1) {
      new DataView(data.buffer).setBigUint64(56 + local * 144, 10_000n, true);
      new DataView(data.buffer).setBigUint64(64 + local * 144, 10_000n, true);
    }
    return { ...row, data };
  }) };
  assert.equal((await decodeMimirBetaCaptureCandidate(neighbourHeavy)).minDepthTo50BpsNative, forward.minDepthTo50BpsNative);
  assert.equal((await decodeMimirBetaCaptureCandidate({ ...neighbourHeavy, pair: reversePair, expectedPlan: planFor(fixture, reversePair) })).minDepthTo50BpsNative,
    reverse.minDepthTo50BpsNative);
}
const damm = await makeBetaCaptureFixture("meteora-damm-v2", { seed: 203 });
{
  const c = await decodeMimirBetaCaptureCandidate((await makeBetaCaptureFixture("meteora-damm-v2", { seed: 203, curveLiquidity: 0n })).input);
  assert.equal(c.minDepthTo50BpsNative, 0n, "DAMM-v2 L=0"); assert.equal(c.conditions, MIMIR_COND.DEPTH_BELOW_FLOOR);
}
assert.deepEqual(new Set(damm.input.expectedPlan.auxiliary.map((node) => node.role)),
  new Set(["base-mint", "quote-mint", "base-vault", "quote-vault"]));
const zeroDlmmStep = await makeBetaCaptureFixture("meteora-dlmm", { seed: 202 });
const zeroStepPrimary = { ...poolRow(zeroDlmmStep), data: poolRow(zeroDlmmStep).data.slice() };
new DataView(zeroStepPrimary.data.buffer).setUint16(80, 0, true);
assert.throws(() => planFor(zeroDlmmStep, zeroDlmmStep.input.pair, zeroStepPrimary));

const ownedPrimaryBytes = poolRow(damm).data.slice(); const ownedPlan = planFor(damm, damm.input.pair, { ...poolRow(damm), data: ownedPrimaryBytes });
const ownedHash = ownedPlan.planHash; ownedPrimaryBytes.fill(0); assert.equal(ownedPlan.planHash, ownedHash);

const oriented = await makeBetaCaptureFixture("raydium-clmm", { seed: 219, baseDecimals: 3, quoteDecimals: 8 });
const reversePair = { baseMint: oriented.input.pair.quoteMint, quoteMint: oriented.input.pair.baseMint };
const reversePlan = planFor(oriented, reversePair);
const forwardCandidate = await decodeMimirBetaCaptureCandidate(oriented.input);
const reverseCandidate = await decodeMimirBetaCaptureCandidate({ ...oriented.input, pair: reversePair, expectedPlan: reversePlan });
assert.equal(forwardCandidate.canonicalPairKey, reverseCandidate.canonicalPairKey);
assert.equal(forwardCandidate.baseVault, reverseCandidate.quoteVault); assert.equal(forwardCandidate.quoteVault, reverseCandidate.baseVault);
assert.notEqual(forwardCandidate.readPlanHash, reverseCandidate.readPlanHash);
assert.notEqual(forwardCandidate.capacityHash, reverseCandidate.capacityHash);
assert.throws(() => assertUnambiguousMimirBetaCaptureCandidates([forwardCandidate, reverseCandidate]),
  (error) => (error as { code?: string }).code === "PAIR_ORIENTATION_CONFLICT");

const driftFixture = await makeBetaCaptureFixture("raydium-cpmm", { seed: 231 });
const driftExpected = await decodeMimirBetaCaptureCandidate(driftFixture.input);
const primaryDrift = replaceRow(driftFixture, driftFixture.input.expectedPlan.pool, (row) => {
  const data = row.data.slice(); data[data.length - 1] ^= 1; return { ...row, data };
});
const driftPlan = planFor(driftFixture, driftFixture.input.pair,
  primaryDrift.accounts.find((row) => row.address === driftFixture.input.expectedPlan.pool)!);
assert.notEqual(driftPlan.primaryDataSha256, driftFixture.input.expectedPlan.primaryDataSha256);
assert.equal(driftPlan.planHash, driftFixture.input.expectedPlan.planHash);
const primaryChanged = await decodeMimirBetaCaptureCandidate(primaryDrift);
assert.notEqual(primaryChanged.capacityHash, driftExpected.capacityHash);
await assert.rejects(() => revalidateMimirBetaCaptureCandidate({ expected: driftExpected, input: primaryDrift }),
  (error) => (error as { code?: string }).code === "POOL_STALE");
const observation = driftFixture.input.expectedPlan.auxiliary.find((node) => node.role === "cpmm-observation")!;
const auxiliaryDrift = replaceRow(driftFixture, observation.address, (row) => {
  const data = row.data.slice(); data[data.length - 1] ^= 1; return { ...row, data };
});
const changed = await decodeMimirBetaCaptureCandidate(auxiliaryDrift);
assert.notEqual(changed.capacityHash, driftExpected.capacityHash);
await assert.rejects(() => revalidateMimirBetaCaptureCandidate({ expected: driftExpected, input: auxiliaryDrift }),
  (error) => (error as { code?: string }).code === "POOL_STALE");
const structuralFixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 232 });
for (const mutate of [
  (data: Uint8Array) => { data[structuralFixture.input.descriptor.status!.offset] = 1; },
  (data: Uint8Array) => { new DataView(data.buffer).setBigUint64(structuralFixture.input.descriptor.activation!.offset, 1n, true); },
]) {
  const changedInput = replaceRow(structuralFixture, structuralFixture.input.expectedPlan.pool, (row) => {
    const data = row.data.slice(); mutate(data); return { ...row, data };
  });
  const changedPrimary = changedInput.accounts.find((row) => row.address === structuralFixture.input.expectedPlan.pool)!;
  assert.notEqual(planFor(structuralFixture, structuralFixture.input.pair, changedPrimary).planHash,
    structuralFixture.input.expectedPlan.planHash);
  await rejects(changedInput, ["CAPTURE_PLAN_MISMATCH"]);
}
const crossingFixture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 233, activeId: 0, binStep: 10 });
const crossingInput = replaceRow(crossingFixture, crossingFixture.input.expectedPlan.pool, (row) => {
  const data = row.data.slice(); new DataView(data.buffer).setInt32(76, 100, true); return { ...row, data };
});
await rejects(crossingInput, ["CAPTURE_PLAN_MISMATCH"]);
const racingFixture = cloneBetaCaptureFixture(orca); const immutableExpected = await decodeMimirBetaCaptureCandidate(cloneBetaCaptureFixture(orca).input);
const pending = decodeMimirBetaCaptureCandidate(racingFixture.input);
for (const row of racingFixture.input.accounts) row.data.fill(0);
assert.equal((await pending).capacityHash, immutableExpected.capacityHash);

const ranked = [...decodedByFamily.values()].sort(compareMimirBetaCaptureCandidates);
assert(ranked.every((candidate) => candidate.direction === "quote-per-base"));
const singleSeeds = [1, 4, 7, 13] as const;
const singles = await Promise.all(singleSeeds.map(async (seed, index) => decodeMimirBetaCaptureCandidate((await makeBetaCaptureFixture(
  "meteora-damm-v2", { seed, baseMint: fixtureAddress(30 + index * 2), quoteMint: fixtureAddress(31 + index * 2) },
)).input)));
const cohort = selectMimirBetaCaptureCohort([...decodedByFamily.values(), ...singles]);
assert.equal(cohort.pairs.length, 5); assert.equal(cohort.pools.length, 9);

const sameFamilyPair = { baseMint: fixtureAddress(20), quoteMint: fixtureAddress(21) };
const lowerEligiblePair = { baseMint: fixtureAddress(30), quoteMint: fixtureAddress(31) };
const sameFamilyFixtures = await Promise.all([0, 1, 2, 3, 4].map((index) => makeBetaCaptureFixture("meteora-damm-v2", {
  seed: 180 + index, ...sameFamilyPair, baseAmount: 30_000_000n - BigInt(index) * 100_000n,
  quoteAmount: 36_000_000n - BigInt(index) * 100_000n,
})));
const lowerEligibleFixtures = await Promise.all([0, 1, 2, 3, 4].map((index) => makeBetaCaptureFixture("meteora-damm-v2", {
  seed: 190 + index, ...lowerEligiblePair, baseAmount: 10_000_000n - BigInt(index) * 100_000n,
  quoteAmount: 12_000_000n - BigInt(index) * 100_000n,
})));
const lowerFamilySubstitute = await makeBetaCaptureFixture("raydium-cpmm", {
  seed: 196, ...sameFamilyPair, baseAmount: 1_000_000n, quoteAmount: 1_200_000n,
});
const contractSingles = await Promise.all([0, 1, 2, 3].map((index) => makeBetaCaptureFixture("meteora-damm-v2", {
  seed: 200 + index, baseMint: fixtureAddress(230 + index * 2), quoteMint: fixtureAddress(231 + index * 2),
})),
);
const contractCandidates = await Promise.all([...sameFamilyFixtures, ...lowerEligibleFixtures, lowerFamilySubstitute, ...contractSingles]
  .map((fixture) => decodeMimirBetaCaptureCandidate(fixture.input)));
const contractCohort = selectMimirBetaCaptureCohort(contractCandidates);
const shuffledContractCohort = selectMimirBetaCaptureCohort([...contractCandidates].reverse());
const expectedSameFamilyPools = sameFamilyFixtures.map((fixture) => fixture.input.expectedPlan.pool);
assert.deepEqual(contractCohort, shuffledContractCohort);
assert.deepEqual(contractCohort.pairs[0]!.pools.map((candidate) => candidate.pool), expectedSameFamilyPools);
assert.equal(new Set(contractCohort.pairs[0]!.pools.map((candidate) => candidate.family)).size, 1);
assert.equal(contractCohort.pairs[0]!.pools[0]!.canonicalPairKey,
  (await decodeMimirBetaCaptureCandidate(sameFamilyFixtures[0]!.input)).canonicalPairKey);
assert(!contractCohort.pools.some((candidate) => candidate.pool === lowerFamilySubstitute.input.expectedPlan.pool),
  "a lower-ranked pool must not replace a top-five pool to manufacture family diversity");
assert.equal(contractCohort.pairs.length, 5); assert.equal(contractCohort.pools.length, 9);
assert.equal(new Set(contractCohort.pools.map((candidate) => candidate.pool)).size, 9);
assert.equal(new Set(contractCohort.pairs.map((pair) => `${pair.mint0}:${pair.mint1}`)).size, 5);
const fourPoolOnly = new Set([
  ...expectedSameFamilyPools.slice(0, 4), ...contractSingles.map((fixture) => fixture.input.expectedPlan.pool),
]);
assert.throws(() => selectMimirBetaCaptureCohort(contractCandidates.filter((candidate) => fourPoolOnly.has(candidate.pool))),
  (error) => (error as { code?: string }).code === "NO_ELIGIBLE_POOLS");

const programAddress = fixtureAddress(31); const programDataAddress = fixtureAddress(32);
const programDataLink = new Uint8Array(36); new DataView(programDataLink.buffer).setUint32(0, 2, true); programDataLink.set(addressBytes(programDataAddress), 4);
const programData = Uint8Array.from([...new Uint8Array(45), 0x7f, 0x45, 0x4c, 0x46]);
new DataView(programData.buffer).setUint32(0, 3, true);
const relation = decodeUpgradeableProgramRelation(
  { address: programAddress, owner: MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID, executable: true, data: programDataLink },
  { address: programDataAddress, owner: MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID, executable: false,
    data: programData },
);
assert.deepEqual([...relation.elfBytes], [0x7f, 0x45, 0x4c, 0x46]);

const aggregateAddress = (byte: number) => bytesAddress(Uint8Array.from({ length: 32 }, () => byte));
const compareAddresses = (left: Address, right: Address) => Buffer.compare(addressBytes(left), addressBytes(right));
const account = (address: ReturnType<typeof aggregateAddress>, owner: ReturnType<typeof aggregateAddress>, data: Uint8Array,
  executable = false): MimirBetaAccount => ({ address, owner, executable, lamports: 1n, data });

async function makeAggregateFixture(): Promise<MimirBetaCaptureRevalidationInput> {
  const commonBase = aggregateAddress(50); const commonQuote = aggregateAddress(51);
  const primaryFixtures = await Promise.all(FAMILIES.map((family, index) => makeBetaCaptureFixture(family, {
    seed: 10 + index * 31, baseMint: commonBase, quoteMint: commonQuote,
    baseAmount: 10_000_000n - BigInt(index) * 100_000n,
    quoteAmount: 12_000_000n - BigInt(index) * 100_000n,
  })));
  const singleFixtures = await Promise.all([0, 1, 2, 3].map((index) => makeBetaCaptureFixture("meteora-damm-v2", {
    seed: 170 + index * 17,
    baseMint: aggregateAddress(60 + index * 2), quoteMint: aggregateAddress(index === 1 ? 60 : 61 + index * 2),
  })));
  const fixtures = [...primaryFixtures, ...singleFixtures];
  const candidates = await Promise.all(fixtures.map((fixture) => decodeMimirBetaCaptureCandidate(fixture.input)));
  const cohort = selectMimirBetaCaptureCohort(candidates);
  const fixtureByPool = new Map(fixtures.map((fixture) => [fixture.input.expectedPlan.pool, fixture]));
  const selectedPools: MimirBetaCaptureSelectedPoolPlan[] = cohort.pools.map((candidate) => {
    const fixture = fixtureByPool.get(candidate.pool)!;
    return { descriptor: fixture.input.descriptor, pair: fixture.input.pair, context: fixture.input.context,
      expectedPlan: fixture.input.expectedPlan };
  });
  const planAddresses = [...new Set(selectedPools.flatMap((selectedPlan) => selectedPlan.expectedPlan.allAddresses))]
    .sort(compareAddresses);

  const deployment: MimirBetaDeployment = {
    cluster: "localnet",
    mimirProgramId: aggregateAddress(10),
    agentRegistryProgramId: aggregateAddress(11),
    mplCoreProgramId: MIMIR_BETA_MPL_CORE_PROGRAM_ID,
    systemProgramId: MIMIR_BETA_SYSTEM_PROGRAM_ID,
    physicalCollection: aggregateAddress(13),
    collectionPointer: "c1:bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };
  const identity = createMimir8004IdentityAdapter(deployment);
  const [[rootAddress, rootBump], [registryAddress, registryBump]] = await Promise.all([
    identity.deriveRootConfig(), identity.deriveRegistryConfig(),
  ]);
  const authority = aggregateAddress(14);
  const rootData = new Uint8Array(73); rootData.set([42,216,8,82,19,209,223,246]);
  rootData.set(addressBytes(deployment.physicalCollection), 8); rootData.set(addressBytes(authority), 40); rootData[72] = rootBump;
  const registryData = new Uint8Array(73); registryData.set([23,118,10,246,173,231,243,156]);
  registryData.set(addressBytes(deployment.physicalCollection), 8); registryData.set(addressBytes(authority), 40); registryData[72] = registryBump;
  const rootConfig = decodeMimir8004RootConfig(rootData); const registryConfig = decodeMimir8004RegistryConfig(registryData);
  const collectionData = concatBytes(
    getKeySerializer().serialize(Key.CollectionV1),
    publicKeySerializer().serialize(publicKey(registryAddress)),
    string().serialize("Mimir Agents"), string().serialize("ipfs://collection"),
    u32().serialize(1), u32().serialize(1),
  );

  const rows = new Map<Address, MimirBetaAccount>();
  const addRow = (row: MimirBetaAccount): void => {
    const prior = rows.get(row.address);
    if (prior) {
      assert.equal(prior.owner, row.owner); assert.equal(prior.executable, row.executable);
      assert.deepEqual(prior.data, row.data); return;
    }
    rows.set(row.address, row);
  };
  for (const fixture of fixtures) for (const row of fixture.input.accounts) {
    addRow({ ...row, lamports: 1n, data: row.data.slice() });
  }

  const sourcePrograms = [...new Set(cohort.pools.map((candidate) => candidate.programId))];
  const programRoles = new Map<Address, MimirBetaCaptureExecutableProgramRole>(sourcePrograms.map((program) => [program, "source-program"]));
  programRoles.set(deployment.agentRegistryProgramId, "agent-registry-program");
  programRoles.set(deployment.mplCoreProgramId, "mpl-core-program");
  const programs: MimirBetaCaptureProgramRelation[] = [];
  let relationIndex = 0;
  for (const [program, role] of programRoles) {
    const programDataAddress = aggregateAddress(100 + relationIndex);
    const link = new Uint8Array(36); new DataView(link.buffer).setUint32(0, 2, true); link.set(addressBytes(programDataAddress), 4);
    const elf = Uint8Array.of(0x7f, 0x45, 0x4c, 0x46, relationIndex + 1);
    const data = concatBytes(new Uint8Array(45), elf); new DataView(data.buffer).setUint32(0, 3, true);
    addRow(account(program, MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID, link, true));
    addRow(account(programDataAddress, MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID, data));
    programs.push({ program, programData: programDataAddress, loader: MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID,
      programDataElfOffset: 45, programDataElfLength: elf.length,
      programDataElfSha256: createHash("sha256").update(elf).digest("hex"), roles: [role] });
    relationIndex += 1;
  }
  programs.sort((left, right) => compareAddresses(left.program, right.program));
  addRow(account(rootAddress, deployment.agentRegistryProgramId, rootData));
  addRow(account(registryAddress, deployment.agentRegistryProgramId, registryData));
  addRow(account(deployment.physicalCollection, deployment.mplCoreProgramId, collectionData));

  const graph = new Map<Address, { roles: Set<MimirBetaCaptureRole>; derivedFrom: Set<Address> }>();
  const addRole = (nodeAddress: Address, role: MimirBetaCaptureRole, derivedFrom: readonly Address[]): void => {
    const node = graph.get(nodeAddress) ?? { roles: new Set(), derivedFrom: new Set() };
    node.roles.add(role); for (const dependency of derivedFrom) node.derivedFrom.add(dependency); graph.set(nodeAddress, node);
  };
  for (const candidate of cohort.pools) {
    const plan = selectedPools.find((entry) => entry.expectedPlan.pool === candidate.pool)!.expectedPlan;
    addRole(candidate.pool, "pool", [candidate.programId]);
    for (const node of plan.auxiliary) addRole(node.address, node.role, node.derivedFrom);
  }
  for (const relationExpectation of programs) {
    const role = relationExpectation.roles[0];
    addRole(relationExpectation.program, role, []);
    addRole(relationExpectation.programData, role === "source-program" ? "source-program-data" :
      role === "agent-registry-program" ? "agent-registry-program-data" : "mpl-core-program-data", [relationExpectation.program]);
  }
  addRole(rootAddress, "8004-root-config", [deployment.agentRegistryProgramId]);
  addRole(registryAddress, "8004-registry-config", [deployment.agentRegistryProgramId, deployment.physicalCollection]);
  addRole(deployment.physicalCollection, "physical-core-collection", [deployment.mplCoreProgramId, registryAddress]);
  const roleGraph: MimirBetaCaptureRoleNode[] = [...graph.entries()].map(([nodeAddress, node]) => ({
    address: nodeAddress,
    roles: [...node.roles].sort() as [MimirBetaCaptureRole, ...MimirBetaCaptureRole[]],
    derivedFrom: [...node.derivedFrom].sort(compareAddresses),
  })).sort((left, right) => compareAddresses(left.address, right.address));
  assert(rows.size < 96); assert.deepEqual([...rows.keys()].sort(compareAddresses), roleGraph.map((node) => node.address));
  return {
    preGma: { cohort, selectedPools, planAddresses, roleGraph, programs },
    trust: { deployment, rootConfig, registryConfig }, accounts: [...rows.values()],
  };
}

const aggregateFixture = await makeAggregateFixture();
const aggregateResult = await revalidateMimirBetaCapture(aggregateFixture);
assert.equal(aggregateResult.schema, "mimir-beta-capture-revalidation-v1");
assert.equal(aggregateResult.cohort.pairs.length, 5); assert.equal(aggregateResult.cohort.pools.length, 9);
assert.deepEqual(aggregateResult.planAddresses, aggregateFixture.preGma.planAddresses);
assert.deepEqual(aggregateResult.roleGraph, aggregateFixture.preGma.roleGraph);
assert.deepEqual(aggregateResult.programs, aggregateFixture.preGma.programs);
assert(Object.isFrozen(aggregateResult) && Object.isFrozen(aggregateResult.cohort) && Object.isFrozen(aggregateResult.cohort.pairs) &&
  Object.isFrozen(aggregateResult.cohort.pairs[0]!.pools) && Object.isFrozen(aggregateResult.roleGraph[0]!.roles));
assert.notEqual(aggregateResult.cohort, aggregateFixture.preGma.cohort);
const shuffled = structuredClone(aggregateFixture); (shuffled.accounts as MimirBetaAccount[]).reverse();
assert.deepEqual(await revalidateMimirBetaCapture(shuffled), aggregateResult);
assert(aggregateResult.roleGraph.some((node) => node.roles.length > 1), "shared plan roles must merge");

const finalDriftFixture = structuredClone(aggregateFixture);
const firstPlan = finalDriftFixture.preGma.selectedPools[0]!;
const firstPrimary = finalDriftFixture.accounts.find((row) => row.address === firstPlan.expectedPlan.pool)!;
firstPrimary.data[firstPrimary.data.length - 1] ^= 1;
const firstVault = finalDriftFixture.accounts.find((row) => row.address === firstPlan.expectedPlan.baseVault)!;
const firstVaultView = new DataView(firstVault.data.buffer, firstVault.data.byteOffset, firstVault.data.byteLength);
firstVaultView.setBigUint64(64, firstVaultView.getBigUint64(64, true) + 1_000n, true);
const cpmmPlan = finalDriftFixture.preGma.selectedPools.find((entry) => entry.descriptor.family === "raydium-cpmm")!;
const cpmmPrimary = finalDriftFixture.accounts.find((row) => row.address === cpmmPlan.expectedPlan.pool)!;
new DataView(cpmmPrimary.data.buffer, cpmmPrimary.data.byteOffset, cpmmPrimary.data.byteLength).setBigUint64(341, 10n, true);
const cpmmObservation = cpmmPlan.expectedPlan.auxiliary.find((node) => node.role === "cpmm-observation")!;
finalDriftFixture.accounts.find((row) => row.address === cpmmObservation.address)!.data[100] ^= 1;
const dlmmPlan = finalDriftFixture.preGma.selectedPools.find((entry) => entry.descriptor.family === "meteora-dlmm")!;
const dlmmPrimary = finalDriftFixture.accounts.find((row) => row.address === dlmmPlan.expectedPlan.pool)!;
new DataView(dlmmPrimary.data.buffer, dlmmPrimary.data.byteOffset, dlmmPrimary.data.byteLength).setInt32(76, 1, true);
const finalDriftResult = await revalidateMimirBetaCapture(finalDriftFixture);
assert.deepEqual(finalDriftResult.cohort.pools.map((candidate) => candidate.pool),
  aggregateFixture.preGma.cohort.pools.map((candidate) => candidate.pool));
const recomputedFirst = await decodeMimirBetaCaptureCandidate({
  descriptor: firstPlan.descriptor, pair: firstPlan.pair, context: firstPlan.context, expectedPlan: firstPlan.expectedPlan,
  accounts: firstPlan.expectedPlan.allAddresses.map((accountAddress) => {
    const row = finalDriftFixture.accounts.find((candidate) => candidate.address === accountAddress)!;
    return { address: row.address, owner: row.owner, executable: row.executable, data: row.data };
  }),
});
assert.deepEqual(finalDriftResult.cohort.pools.find((candidate) => candidate.pool === recomputedFirst.pool), recomputedFirst);
assert.notEqual(finalDriftResult.cohort.pools.find((candidate) => candidate.pool === recomputedFirst.pool)!.capacityHash,
  aggregateFixture.preGma.cohort.pools.find((candidate) => candidate.pool === recomputedFirst.pool)!.capacityHash);

const aggregateRejects = async (mutate: (fixture: MimirBetaCaptureRevalidationInput) => void): Promise<void> => {
  const fixture = structuredClone(aggregateFixture); mutate(fixture);
  await assert.rejects(() => revalidateMimirBetaCapture(fixture));
};
await aggregateRejects((fixture) => { (fixture.accounts as MimirBetaAccount[]).pop(); });
await aggregateRejects((fixture) => { (fixture.accounts as MimirBetaAccount[]).push(account(aggregateAddress(240), aggregateAddress(241), Uint8Array.of(1))); });
await aggregateRejects((fixture) => { (fixture.accounts as MimirBetaAccount[]).push(fixture.accounts[0]!); });
await aggregateRejects((fixture) => { (fixture.accounts as unknown as null[])[0] = null; });
await assert.rejects(() => {
  const fixture = structuredClone(aggregateFixture);
  (fixture.accounts as MimirBetaAccount[]).length = 100;
  (fixture.accounts as MimirBetaAccount[]).fill(fixture.accounts[0]!);
  return revalidateMimirBetaCapture(fixture);
}, /CAPTURE_PLAN_MISMATCH:duplicate global captured account/);
await assert.rejects(() => {
  const fixture = structuredClone(aggregateFixture);
  (fixture.accounts as MimirBetaAccount[]).length = 101;
  (fixture.accounts as MimirBetaAccount[]).fill(fixture.accounts[0]!);
  return revalidateMimirBetaCapture(fixture);
}, /CAPTURE_PLAN_MISMATCH:global captured account count is out of bounds/);
await aggregateRejects((fixture) => { (fixture.preGma.selectedPools as MimirBetaCaptureSelectedPoolPlan[]).pop(); });
await aggregateRejects((fixture) => { (fixture.preGma.selectedPools as MimirBetaCaptureSelectedPoolPlan[]).push(fixture.preGma.selectedPools[0]!); });
await aggregateRejects((fixture) => { (fixture.preGma.selectedPools as MimirBetaCaptureSelectedPoolPlan[])[0] = {
  ...fixture.preGma.selectedPools[0]!, expectedPlan: { ...fixture.preGma.selectedPools[0]!.expectedPlan, pool: aggregateAddress(239) },
}; });
await aggregateRejects((fixture) => { (fixture.preGma.cohort.pools as typeof fixture.preGma.cohort.pools & { reverse(): void }).reverse(); });
await aggregateRejects((fixture) => { (fixture.preGma.planAddresses as unknown as Address[]).reverse(); });
await aggregateRejects((fixture) => { (fixture.preGma.selectedPools[0]!.expectedPlan.auxiliary as unknown as Array<{ role: string }>)[0]!.role = "quote-mint"; });
await aggregateRejects((fixture) => { const selectedPlan = fixture.preGma.selectedPools[0]!;
  const row = fixture.accounts.find((entry) => entry.address === selectedPlan.expectedPlan.pool)!;
  row.data.set(addressBytes(aggregateAddress(238)), selectedPlan.descriptor.vaultAOffset); });

const relationMutation = async (mutate: (program: MimirBetaAccount, programData: MimirBetaAccount,
  expected: MimirBetaCaptureProgramRelation) => void): Promise<void> => aggregateRejects((fixture) => {
  const expected = fixture.preGma.programs[0]!;
  const program = fixture.accounts.find((row) => row.address === expected.program)!;
  const programDataRow = fixture.accounts.find((row) => row.address === expected.programData)!;
  mutate(program, programDataRow, expected);
});
{
  const headerOnly = structuredClone(aggregateFixture);
  const expected = headerOnly.preGma.programs[0]!;
  const row = headerOnly.accounts.find((entry) => entry.address === expected.programData)! as { data: Uint8Array };
  row.data = row.data.slice(0, 45);
  await revalidateMimirBetaCapture(headerOnly);
  new DataView(row.data.buffer).setBigUint64(4, 999_999_999n, true);
  await assert.rejects(() => revalidateMimirBetaCapture(headerOnly));
}
await relationMutation((program) => { (program as { owner: string }).owner = aggregateAddress(230); });
await relationMutation((program) => { (program as { executable: boolean }).executable = false; });
await relationMutation((program) => { program.data[0] ^= 1; });
await relationMutation((program) => { program.data.set(addressBytes(aggregateAddress(229)), 4); });
await relationMutation((_program, programDataRow) => { (programDataRow as { owner: string }).owner = aggregateAddress(228); });
await relationMutation((_program, programDataRow) => { (programDataRow as { executable: boolean }).executable = true; });
await relationMutation((_program, programDataRow) => { programDataRow.data[0] ^= 1; });
await relationMutation((_program, programDataRow) => { programDataRow.data[12] = 1; });
await relationMutation((_program, programDataRow) => { programDataRow.data[programDataRow.data.length - 1] ^= 1; });
await relationMutation((_program, programDataRow) => { (programDataRow as { data: Uint8Array }).data = programDataRow.data.slice(0, -1); });
await relationMutation((_program, _programDataRow, expected) => { (expected as { programDataElfSha256: string }).programDataElfSha256 = "0".repeat(64); });
await aggregateRejects((fixture) => { (fixture.preGma.programs[1] as { programData: string }).programData = fixture.preGma.programs[0]!.programData; });
await aggregateRejects((fixture) => { (fixture.preGma.programs[0] as unknown as { roles: string[] }).roles = ["mpl-core-program"]; });
await aggregateRejects((fixture) => { (fixture.preGma.programs[0] as unknown as { roles: string[] }).roles = ["arbitrary-role"]; });
await aggregateRejects((fixture) => { (fixture.preGma.programs[0] as unknown as { override: string }).override = "runner-policy"; });
for (const forbiddenProgram of [aggregateFixture.trust.deployment.mimirProgramId, aggregateFixture.trust.deployment.systemProgramId,
  MIMIR_BETA_SPL_TOKEN_PROGRAM_ID]) {
  await aggregateRejects((fixture) => { (fixture.preGma.programs[0] as { program: string }).program = forbiddenProgram; });
}

const rootRole = aggregateFixture.preGma.roleGraph.find((node) => node.roles.includes("8004-root-config"))!;
const registryRole = aggregateFixture.preGma.roleGraph.find((node) => node.roles.includes("8004-registry-config"))!;
for (const roleNode of [rootRole, registryRole]) {
  await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === roleNode.address)!;
    (row as { owner: string }).owner = aggregateAddress(227); });
  await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === roleNode.address)!;
    (row as { executable: boolean }).executable = true; });
  await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === roleNode.address)!; row.data[0] ^= 1; });
  await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === roleNode.address)!;
    (row as { data: Uint8Array }).data = row.data.slice(0, -1); });
  await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === roleNode.address)!; row.data[72] ^= 1; });
}
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === rootRole.address)!;
  row.data.set(addressBytes(aggregateAddress(226)), 40); });
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === registryRole.address)!;
  row.data.set(addressBytes(aggregateAddress(225)), 8); });
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === rootRole.address)!;
  (row as { address: string }).address = aggregateAddress(224); });
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === registryRole.address)!;
  (row as { address: string }).address = aggregateAddress(223); });

const collectionAddress = aggregateFixture.trust.deployment.physicalCollection;
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === collectionAddress)!;
  (row as { address: string }).address = aggregateAddress(223); });
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === collectionAddress)!;
  (row as { owner: string }).owner = aggregateAddress(222); });
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === collectionAddress)!;
  (row as { executable: boolean }).executable = true; });
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === collectionAddress)!; row.data[0] ^= 1; });
await aggregateRejects((fixture) => { const row = fixture.accounts.find((entry) => entry.address === collectionAddress)!;
  row.data.set(addressBytes(aggregateAddress(221)), 1); });
await aggregateRejects((fixture) => { (fixture.preGma.roleGraph[0] as unknown as { roles: string[] }).roles = ["runner-added-role"]; });
await aggregateRejects((fixture) => { (fixture.preGma.roleGraph as MimirBetaCaptureRoleNode[]).push({
  address: aggregateAddress(220), roles: ["pool"], derivedFrom: [],
}); });
await aggregateRejects((fixture) => { (fixture.accounts as MimirBetaAccount[]).push(
  account(aggregateAddress(219), MIMIR_BETA_UPGRADEABLE_LOADER_PROGRAM_ID, Uint8Array.of(1), true),
); });

const racedAggregate = structuredClone(aggregateFixture);
const aggregatePending = revalidateMimirBetaCapture(racedAggregate);
for (const row of racedAggregate.accounts) row.data.fill(0);
(racedAggregate.preGma.programs[0] as { programDataElfSha256: string }).programDataElfSha256 = "0".repeat(64);
(racedAggregate.preGma.roleGraph[0] as unknown as { roles: string[] }).roles = ["pool"];
assert.deepEqual(await aggregatePending, aggregateResult);

const candidateRaceFixture = cloneBetaCaptureFixture(cpmm);
const candidateRaceExpected = structuredClone(await decodeMimirBetaCaptureCandidate(candidateRaceFixture.input));
const candidateRacePending = revalidateMimirBetaCaptureCandidate({ expected: candidateRaceExpected, input: candidateRaceFixture.input });
(candidateRaceExpected as { minLiquidityNative: bigint }).minLiquidityNative = 0n;
assert.equal((await candidateRacePending).capacityHash, (await decodeMimirBetaCaptureCandidate(cpmm.input)).capacityHash);

const tokenPairBase = fixtureAddress(230);
const tokenPairQuote = fixtureAddress(231);
const tokenPairBaseVault = fixtureAddress(232);
const tokenPairQuoteVault = fixtureAddress(233);
const tokenPairAuthority = fixtureAddress(234);
const simpleMint = (mint: Address, owner: Address): MimirBetaCapturedAccount => {
  const data = new Uint8Array(82); data[44] = 6; data[45] = 1;
  return { address: mint, owner, executable: false, data };
};
const simpleVault = (vault: Address, mint: Address, owner: Address, nativeTag = 0): MimirBetaCapturedAccount => {
  const data = new Uint8Array(165); data.set(addressBytes(mint), 0); data.set(addressBytes(tokenPairAuthority), 32);
  new DataView(data.buffer).setBigUint64(64, 1n, true); data[108] = 1; new DataView(data.buffer).setUint32(109, nativeTag, true);
  return { address: vault, owner, executable: false, data };
};
const pairArgs = (baseOwner: Address, quoteOwner: Address) => ({
  baseMint: tokenPairBase, quoteMint: tokenPairQuote,
  baseMintAccount: simpleMint(tokenPairBase, baseOwner), quoteMintAccount: simpleMint(tokenPairQuote, quoteOwner),
  baseVaultAccount: simpleVault(tokenPairBaseVault, tokenPairBase, baseOwner),
  quoteVaultAccount: simpleVault(tokenPairQuoteVault, tokenPairQuote, quoteOwner),
  authority: tokenPairAuthority, baseDecimals: 6, quoteDecimals: 6,
});
const classicPair = classifyToken2022ClmmPair(pairArgs(MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID));
assert.equal(classicPair.adapterVersion, 0);
assert.equal(classicPair.token2022Mint, null);
const nativeMint = address("So11111111111111111111111111111111111111112");
const nativePair = classifyToken2022ClmmPair({
  ...pairArgs(MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID),
  baseMint: nativeMint,
  baseMintAccount: simpleMint(nativeMint, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID),
  baseVaultAccount: simpleVault(tokenPairBaseVault, nativeMint, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, 1),
});
assert.equal(nativePair.adapterVersion, 0);
const baseToken2022Pair = classifyToken2022ClmmPair(pairArgs(MIMIR_BETA_TOKEN_2022_PROGRAM_ID, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID));
assert.equal(baseToken2022Pair.adapterVersion, 1);
assert.equal(baseToken2022Pair.token2022Mint, tokenPairBase);
const quoteToken2022Pair = classifyToken2022ClmmPair(pairArgs(MIMIR_BETA_SPL_TOKEN_PROGRAM_ID, MIMIR_BETA_TOKEN_2022_PROGRAM_ID));
assert.equal(quoteToken2022Pair.adapterVersion, 1);
assert.equal(quoteToken2022Pair.token2022Mint, tokenPairQuote);
assert.throws(() => classifyToken2022ClmmPair(pairArgs(MIMIR_BETA_TOKEN_2022_PROGRAM_ID, MIMIR_BETA_TOKEN_2022_PROGRAM_ID)),
  (error) => isToken2022ClmmPolicyError(error) && error.code === "TOKEN_PROGRAM_PAIR_UNSUPPORTED");
const unsupportedMintData = new Uint8Array(170); unsupportedMintData[44] = 6; unsupportedMintData[45] = 1; unsupportedMintData[165] = 1;
new DataView(unsupportedMintData.buffer).setUint16(166, 99, true);
const unsupportedMint: MimirBetaCapturedAccount = { address: tokenPairBase, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, executable: false, data: unsupportedMintData };
assert.throws(() => classifyToken2022ClmmPair({ ...pairArgs(MIMIR_BETA_TOKEN_2022_PROGRAM_ID, MIMIR_BETA_SPL_TOKEN_PROGRAM_ID), baseMintAccount: unsupportedMint }),
  (error) => isToken2022ClmmPolicyError(error) && error.code === "TOKEN_2022_POLICY_UNSUPPORTED");

const clmmV1Fixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 431 });
const withToken2022Side = (baseSelected: boolean, mutation?: (row: MimirBetaCapturedAccount) => MimirBetaCapturedAccount): MimirBetaCaptureCandidateInput => {
  const mint = baseSelected ? clmmV1Fixture.input.pair.baseMint : clmmV1Fixture.input.pair.quoteMint;
  const vault = baseSelected ? clmmV1Fixture.input.expectedPlan.baseVault : clmmV1Fixture.input.expectedPlan.quoteVault;
  return { ...clmmV1Fixture.input, accounts: clmmV1Fixture.input.accounts.map((row) => {
    if (row.address === mint || row.address === vault) return mutation?.(row) ?? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID };
    return row;
  }) };
};
for (const baseSelected of [true, false]) {
  const candidate = await decodeMimirBetaCaptureCandidate(withToken2022Side(baseSelected));
  const expectedMint = baseSelected ? clmmV1Fixture.input.pair.baseMint : clmmV1Fixture.input.pair.quoteMint;
  assert.equal(candidate.adapterVersion, 1);
  assert.equal(candidate.token2022Mint, expectedMint);
  const creation = buildMimirBetaPoolCreationBinding(candidate);
  assert.deepEqual(creation.staticAccounts.map((account) => account.role), ["base-vault", "quote-vault", "pool", "amm-config", "token2022-mint"]);
  assert.equal(creation.staticAccounts[4]!.address, expectedMint);
  assert.match(candidate.token2022PolicyHash!, /^[0-9a-f]{64}$/);
}
assert.equal((await decodeMimirBetaCaptureCandidate(clmmV1Fixture.input)).token2022PolicyHash, null);

const makeClmmFloorInput = async (
  capture: MimirBetaCaptureCandidateInput,
  minima: Readonly<{ liquidity: bigint; depth: bigint }>,
) => {
  const candidate = await decodeMimirBetaCaptureCandidate(capture);
  const poolRow = capture.accounts.find((row) => row.address === candidate.pool)!;
  const sourceConfigData = buildTestRaydiumClmmSourceConfigHeader(0, (data) => {
    RAYDIUM_CLMM_MAINNET_PROGRAM_ID.toBuffer().copy(data, SOURCE_OFFSETS.programId);
    new PublicKey(candidate.pool).toBuffer().copy(data, SOURCE_OFFSETS.poolOrMarket);
    new PublicKey(candidate.baseVault).toBuffer().copy(data, SOURCE_OFFSETS.baseVault);
    new PublicKey(candidate.quoteVault).toBuffer().copy(data, SOURCE_OFFSETS.quoteVault);
    new PublicKey(candidate.baseMint).toBuffer().copy(data, SOURCE_OFFSETS.baseMint);
    new PublicKey(candidate.quoteMint).toBuffer().copy(data, SOURCE_OFFSETS.quoteMint);
    new PublicKey(candidate.vaultAuthority).toBuffer().copy(data, SOURCE_OFFSETS.vaultAuthority);
    new PublicKey(candidate.tokenProgramId).toBuffer().copy(data, SOURCE_OFFSETS.tokenProgram);
    data.writeUInt16LE(candidate.adapterVersion, SOURCE_OFFSETS.adapterVersion);
    writeFloorU128(data, SOURCE_OFFSETS.minLiquidityNative, minima.liquidity);
    writeFloorU128(data, SOURCE_OFFSETS.minDepthTo50BpsNative, minima.depth);
  });
  const contextSlot = capture.context.observedSlot;
  const contextual = (row: MimirBetaCapturedAccount) => ({
    address: new PublicKey(row.address), owner: new PublicKey(row.owner), data: row.data,
    executable: row.executable, contextSlot,
  });
  return {
    expectedFeedId: TEST_FEED_ID,
    expectedSourceIndex: 0,
    currentUnixTs: capture.context.observedUnixTimestamp,
    sourceConfig: {
      address: findSourceConfigPda(TEST_FEED_ID, 0)[0], owner: MIMIR_PROGRAM_ID,
      data: sourceConfigData, executable: false, contextSlot,
    },
    pool: contextual(poolRow),
    captureAccounts: capture.accounts.map(contextual),
  };
};

const clmmV0Candidate = await decodeMimirBetaCaptureCandidate(clmmV1Fixture.input);
const clmmV0FloorInput = await makeClmmFloorInput(clmmV1Fixture.input, {
  liquidity: clmmV0Candidate.minLiquidityNative,
  depth: clmmV0Candidate.minDepthTo50BpsNative,
});
const clmmV0Floor = await inspectRaydiumClmmSourceFloorProof(clmmV0FloorInput);
assert.equal(clmmV0Floor.status, "source_floor_validated");
assert.equal(clmmV0Floor.proofScope, "clmm_source_floor_only");
assert.equal(clmmV0Floor.liquidityNative, clmmV0Candidate.minLiquidityNative);
const clmmBelowFloor = await inspectRaydiumClmmSourceFloorProof(await makeClmmFloorInput(clmmV1Fixture.input, {
  liquidity: clmmV0Candidate.minLiquidityNative + 1n,
  depth: clmmV0Candidate.minDepthTo50BpsNative,
}));
assert.equal(clmmBelowFloor.status, "below_minimum");
if (clmmBelowFloor.status !== "below_minimum") throw new Error("expected CLMM floor shortfall");
assert.equal(clmmBelowFloor.belowLiquidityMinimum, true);
const clmmV1Capture = withToken2022Side(true);
const clmmV1Candidate = await decodeMimirBetaCaptureCandidate(clmmV1Capture);
const clmmV1FloorInput = await makeClmmFloorInput(clmmV1Capture, {
  liquidity: clmmV1Candidate.minLiquidityNative,
  depth: clmmV1Candidate.minDepthTo50BpsNative,
});
assert.equal((await inspectRaydiumClmmSourceFloorProof(clmmV1FloorInput)).status, "source_floor_validated");
const clmmWrongContext = clmmV0FloorInput.captureAccounts.map((account, index) => index === 1
  ? { ...account, contextSlot: account.contextSlot + 1n } : account);
const clmmWrongContextResult = await inspectRaydiumClmmSourceFloorProof({ ...clmmV0FloorInput, captureAccounts: clmmWrongContext });
assert.equal(clmmWrongContextResult.status, "unavailable");
if (clmmWrongContextResult.status !== "unavailable") throw new Error("expected CLMM context mismatch");
assert.equal(clmmWrongContextResult.reason, "context_mismatch");
const clmmMissing2022Mint = clmmV1FloorInput.captureAccounts.filter((account) =>
  !account.address.equals(new PublicKey(clmmV1Candidate.token2022Mint!)));
const clmmMissing2022MintResult = await inspectRaydiumClmmSourceFloorProof({ ...clmmV1FloorInput, captureAccounts: clmmMissing2022Mint });
assert.equal(clmmMissing2022MintResult.status, "unavailable");
if (clmmMissing2022MintResult.status !== "unavailable") throw new Error("expected missing CLMM Token-2022 mint");
assert.equal(clmmMissing2022MintResult.reason, "invalid_capture");

const putExtension = (row: MimirBetaCapturedAccount, accountType: number, type: number, value: Uint8Array): Uint8Array => {
  const data = new Uint8Array(166 + 4 + value.length);
  data.set(row.data.slice(0, 165)); data[165] = accountType;
  const view = new DataView(data.buffer); view.setUint16(166, type, true); view.setUint16(168, value.length, true);
  data.set(value, 170);
  return data;
};
const putExtensions = (row: MimirBetaCapturedAccount, accountType: number, extensions: readonly (readonly [number, Uint8Array])[]): Uint8Array => {
  const data = new Uint8Array(166 + extensions.reduce((size, [, value]) => size + 4 + value.length, 0));
  data.set(row.data.slice(0, 165)); data[165] = accountType;
  const view = new DataView(data.buffer); let offset = 166;
  for (const [type, value] of extensions) {
    view.setUint16(offset, type, true); view.setUint16(offset + 2, value.length, true); data.set(value, offset + 4); offset += 4 + value.length;
  }
  return data;
};
const pumpMetadataMint = (mint: Address, row: MimirBetaCapturedAccount, pointerMint = mint) => {
  const pointer = new Uint8Array(64); pointer.set(addressBytes(pointerMint), 32);
  const metadata = new Uint8Array(166); metadata.set(addressBytes(mint), 32);
  const fields = ["Mimir metadata token", "MIMIR", "u".repeat(61)]; let offset = 64;
  for (const field of fields) { const bytes = new TextEncoder().encode(field); new DataView(metadata.buffer).setUint32(offset, bytes.length, true); offset += 4; metadata.set(bytes, offset); offset += bytes.length; }
  new DataView(metadata.buffer).setUint32(offset, 0, true);
  return putExtensions(row, 1, [[18, pointer], [19, metadata]]);
};
const pumpImmutableOwnerVault = (row: MimirBetaCapturedAccount) => putExtension(row, 2, 7, new Uint8Array());
const scaledMint = (row: MimirBetaCapturedAccount, multiplierBits = 0x3ff0000000000000n): Uint8Array => {
  const value = new Uint8Array(56); const view = new DataView(value.buffer);
  view.setBigUint64(32, multiplierBits, true); view.setBigInt64(40, 0n, true); view.setBigUint64(48, multiplierBits, true);
  return putExtension(row, 1, 25, value);
};
const dlmmV1Fixture = await makeBetaCaptureFixture("meteora-dlmm", { seed: 463 });
const dlmmToken2022Input = (baseSelected: boolean, mintData?: Uint8Array, vaultData?: Uint8Array): MimirBetaCaptureCandidateInput => {
  const token2022Mint = baseSelected ? dlmmV1Fixture.input.pair.baseMint : dlmmV1Fixture.input.pair.quoteMint;
  const token2022Vault = baseSelected ? dlmmV1Fixture.input.expectedPlan.baseVault : dlmmV1Fixture.input.expectedPlan.quoteVault;
  const mintRow = dlmmV1Fixture.input.accounts.find((row) => row.address === token2022Mint)!;
  const vaultRow = dlmmV1Fixture.input.accounts.find((row) => row.address === token2022Vault)!;
  return { ...dlmmV1Fixture.input, accounts: dlmmV1Fixture.input.accounts.map((row) => row.address === token2022Mint
    ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: mintData ?? scaledMint(mintRow) }
    : row.address === token2022Vault
      ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: vaultData ?? pumpImmutableOwnerVault(vaultRow) }
      : row) };
};
const dlmmV0Baseline = await decodeMimirBetaCaptureCandidate(dlmmV1Fixture.input);
for (const baseSelected of [true, false]) {
  const token2022Mint = baseSelected
    ? dlmmV1Fixture.input.pair.baseMint
    : dlmmV1Fixture.input.pair.quoteMint;
  const candidate = await decodeMimirBetaCaptureCandidate(dlmmToken2022Input(baseSelected));
  assert.equal(candidate.adapterVersion, 1);
  assert.equal(candidate.token2022Mint, token2022Mint);
  assert.equal(candidate.tokenProgramId, MIMIR_BETA_TOKEN_2022_PROGRAM_ID);
  assert.match(candidate.token2022PolicyHash!, /^[0-9a-f]{64}$/);
  assert(candidate.minDepthTo50BpsNative > 0n);
  assert.equal(candidate.minDepthTo50BpsNative, dlmmV0Baseline.minDepthTo50BpsNative);
  assert.equal(candidate.minLiquidityNative, dlmmV0Baseline.minLiquidityNative);
  const binding = buildMimirBetaPoolCreationBinding(candidate);
  assert.deepEqual(binding.staticAccounts.map((account) => account.role),
    ["base-vault", "quote-vault", "pool", "token2022-mint"]);
  assert.equal(binding.staticAccounts[3]!.address, token2022Mint);
}
const dlmmScaledMintRow = dlmmV1Fixture.input.accounts.find((row) => row.address === dlmmV1Fixture.input.pair.baseMint)!;
const dlmmScaledCandidate = await decodeMimirBetaCaptureCandidate(dlmmToken2022Input(true));
await assert.rejects(() => revalidateMimirBetaCaptureCandidate({
  expected: dlmmScaledCandidate,
  input: dlmmToken2022Input(true, scaledMint(dlmmScaledMintRow, 0x4000000000000000n)),
}), (error) => (error as { code?: string }).code === "POOL_STALE");
const dlmmHookValue = new Uint8Array(64); dlmmHookValue[32] = 1;
await assert.rejects(() => decodeMimirBetaCaptureCandidate(dlmmToken2022Input(true,
  putExtension(dlmmScaledMintRow, 1, 14, dlmmHookValue))),
(error) => (error as { code?: string }).code === "TOKEN_2022_POLICY_UNSUPPORTED");
const dlmmFrozenVault = pumpImmutableOwnerVault(
  dlmmV1Fixture.input.accounts.find((row) => row.address === dlmmV1Fixture.input.expectedPlan.baseVault)!,
);
dlmmFrozenVault[108] = 2;
assert.equal((await decodeMimirBetaCaptureCandidate(dlmmToken2022Input(true, undefined, dlmmFrozenVault))).conditions, MIMIR_COND.VAULT_FROZEN);
const pumpToken2022Input = (mintData: Uint8Array, vaultData: Uint8Array, quoteOwner: Address = MIMIR_BETA_SPL_TOKEN_PROGRAM_ID): MimirBetaCaptureCandidateInput => ({
  ...pump.input, accounts: pump.input.accounts.map((row) => row.address === pump.input.pair.baseMint
    ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: mintData }
    : row.address === pump.input.pair.quoteMint ? { ...row, owner: quoteOwner }
    : row.address === pump.input.expectedPlan.baseVault ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: vaultData } : row),
});
const pumpMintRow = pump.input.accounts.find((row) => row.address === pump.input.pair.baseMint)!;
const pumpVaultRow = pump.input.accounts.find((row) => row.address === pump.input.expectedPlan.baseVault)!;
const metadataPumpInput = pumpToken2022Input(pumpMetadataMint(pump.input.pair.baseMint, pumpMintRow), pumpImmutableOwnerVault(pumpVaultRow));
const metadataPump = await decodeMimirBetaCaptureCandidate(metadataPumpInput);
assert.equal(metadataPump.adapterVersion, 1); assert.equal(metadataPump.token2022Mint, pump.input.pair.baseMint);
assert.equal(metadataPump.token2022PolicyHash, null);
const metadataPumpBinding = buildMimirBetaPoolCreationBinding(metadataPump);
assert.deepEqual(metadataPumpBinding.staticAccounts.map((entry) => entry.role),
  ["base-mint", "quote-mint", "base-vault", "quote-vault", "pool", "global-config", "fee-config"]);
assert.equal(metadataPumpBinding.token2022Mint, pump.input.pair.baseMint);
assert.throws(() => buildMimirBetaPoolCreationBinding({ ...metadataPump, adapterVersion: 0 }));
const vaultOnlyPump = await decodeMimirBetaCaptureCandidate(pumpToken2022Input(pumpMintRow.data, pumpImmutableOwnerVault(pumpVaultRow)));
assert.equal(vaultOnlyPump.adapterVersion, 1); assert.equal(vaultOnlyPump.token2022Mint, pump.input.pair.baseMint);
assert.equal((await decodeMimirBetaCaptureCandidate(pumpToken2022Input(
  pumpMetadataMint(pump.input.pair.baseMint, pumpMintRow, fixtureAddress(233)), pumpImmutableOwnerVault(pumpVaultRow)))).conditions,
MIMIR_COND.TOKEN_PROFILE);
await assert.rejects(() => decodeMimirBetaCaptureCandidate(pumpToken2022Input(
  putExtensions(pumpMintRow, 1, [[18, new Uint8Array(64)], [19, new Uint8Array(166)], [12, new Uint8Array(32)]]), pumpImmutableOwnerVault(pumpVaultRow))),
(error) => (error as { code?: string }).code === "TOKEN_2022_POLICY_UNSUPPORTED");
await assert.rejects(() => decodeMimirBetaCaptureCandidate(pumpToken2022Input(
  pumpMetadataMint(pump.input.pair.baseMint, pumpMintRow), (() => { const data = pumpImmutableOwnerVault(pumpVaultRow); data.set(addressBytes(fixtureAddress(232)), 32); return data; })())),
(error) => (error as { code?: string }).code === "TOKEN_2022_POLICY_UNSUPPORTED");
await assert.rejects(() => decodeMimirBetaCaptureCandidate(pumpToken2022Input(
  pumpMetadataMint(pump.input.pair.baseMint, pumpMintRow), pumpImmutableOwnerVault(pumpVaultRow), MIMIR_BETA_TOKEN_2022_PROGRAM_ID)),
(error) => (error as { code?: string }).code === "TOKEN_PROGRAM_PAIR_UNSUPPORTED");
const inversePumpPair = { baseMint: pump.input.pair.quoteMint, quoteMint: pump.input.pair.baseMint };
await assert.rejects(() => decodeMimirBetaCaptureCandidate({ ...metadataPumpInput, pair: inversePumpPair,
  expectedPlan: planFor(pump, inversePumpPair) }), (error) => (error as { code?: string }).code === "TOKEN_PROGRAM_PAIR_UNSUPPORTED");
const token2022PolicyInput = (mintData: Uint8Array, vaultData: Uint8Array): MimirBetaCaptureCandidateInput => {
  const selectedMint = clmmV1Fixture.input.pair.baseMint;
  const selectedVault = clmmV1Fixture.input.expectedPlan.baseVault;
  return { ...clmmV1Fixture.input, accounts: clmmV1Fixture.input.accounts.map((row) =>
    row.address === selectedMint ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: mintData } :
      row.address === selectedVault ? { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data: vaultData } : row) };
};
const scaledInput = token2022PolicyInput(scaledMint(clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.pair.baseMint)!),
  clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.expectedPlan.baseVault)!.data);
const scaledCandidate = await decodeMimirBetaCaptureCandidate(scaledInput);
assert.equal(scaledCandidate.adapterVersion, 1);
assert.match(scaledCandidate.token2022PolicyHash!, /^[0-9a-f]{64}$/);
assert.equal((await revalidateMimirBetaCaptureCandidate({ expected: scaledCandidate, input: scaledInput })).token2022PolicyHash,
  scaledCandidate.token2022PolicyHash);
const changedScaledInput = token2022PolicyInput(
  scaledMint(clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.pair.baseMint)!, 0x4000000000000000n),
  clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.expectedPlan.baseVault)!.data,
);
await assert.rejects(() => revalidateMimirBetaCaptureCandidate({ expected: scaledCandidate, input: changedScaledInput }),
  (error) => (error as { code?: string }).code === "POOL_STALE");
const pausedValue = new Uint8Array(33); pausedValue[32] = 1;
const pausedInput = token2022PolicyInput(
  putExtension(clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.pair.baseMint)!, 1, 26, pausedValue),
  clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.expectedPlan.baseVault)!.data,
);
await assert.rejects(() => decodeMimirBetaCaptureCandidate(pausedInput),
  (error) => (error as { code?: string }).code === "TOKEN_2022_POLICY_UNSUPPORTED");
const activeHookValue = new Uint8Array(64); activeHookValue[32] = 1;
const activeHookInput = token2022PolicyInput(
  putExtension(clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.pair.baseMint)!, 1, 14, activeHookValue),
  clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.expectedPlan.baseVault)!.data,
);
await assert.rejects(() => decodeMimirBetaCaptureCandidate(activeHookInput),
  (error) => (error as { code?: string }).code === "TOKEN_2022_POLICY_UNSUPPORTED");
for (const rejectedVaultType of [5, 2]) {
  const rejectedVaultInput = token2022PolicyInput(
    scaledMint(clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.pair.baseMint)!),
    putExtension(clmmV1Fixture.input.accounts.find((row) => row.address === clmmV1Fixture.input.expectedPlan.baseVault)!, 2, rejectedVaultType, new Uint8Array()),
  );
  await assert.rejects(() => decodeMimirBetaCaptureCandidate(rejectedVaultInput),
    (error) => (error as { code?: string }).code === "TOKEN_2022_POLICY_UNSUPPORTED");
}
const unsupportedCaptureInput = withToken2022Side(true, (row) => {
  const data = new Uint8Array(170); data.set(row.data); data[165] = 1; new DataView(data.buffer).setUint16(166, 99, true);
  return { ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, data };
});
await assert.rejects(() => decodeMimirBetaCaptureCandidate(unsupportedCaptureInput),
  (error) => (error as { code?: string }).code === "TOKEN_2022_POLICY_UNSUPPORTED");
const malformedCaptureInput = withToken2022Side(true, (row) => ({ ...row, owner: MIMIR_BETA_TOKEN_2022_PROGRAM_ID, executable: true }));
await assert.rejects(() => decodeMimirBetaCaptureCandidate(malformedCaptureInput),
  (error) => (error as { code?: string }).code === "ACCOUNT_MALFORMED");

for (const [family, seed] of [["orca-whirlpool", 1501], ["raydium-cpmm", 1502], ["raydium-amm-v4", 1503], ["meteora-damm-v2", 1504]] as const) {
  const legacyOnly = await makeBetaCaptureFixture(family, { seed });
  const withMintOwner = (owner: Address) => ({ ...legacyOnly.input, accounts: legacyOnly.input.accounts.map((row) =>
    row.address === legacyOnly.input.pair.quoteMint ? { ...row, owner } : row) });
  await assert.rejects(() => decodeMimirBetaCaptureCandidate(withMintOwner(MIMIR_BETA_TOKEN_2022_PROGRAM_ID)),
    (error) => (error as { code?: string }).code === "TOKEN_PROGRAM_PAIR_UNSUPPORTED");
  await assert.rejects(() => decodeMimirBetaCaptureCandidate(withMintOwner(fixtureAddress(249))),
    (error) => (error as { code?: string }).code === "ACCOUNT_OWNER_MISMATCH");
}

console.log("beta capture tests passed");

// Routeable legacy calibration spans the authenticated neighbors; direct capture stays clipped.
for (const activeId of [0, 70]) for (const reverseStorage of [false, true]) {
  const fixture = await makeBetaCaptureFixture("meteora-dlmm", { activeId, binStep: 50, reverseStorage,
    baseAmount: 2_000_000_000n, quoteAmount: 2_000_000_000n });
  const pair = poolRow(fixture); const activeIndex = Math.floor(activeId / 70);
  const arrays = [-1, 0, 1].map((delta) => {
    const index = activeIndex + delta; const le = Buffer.alloc(8); le.writeBigInt64LE(BigInt(index));
    const binAddress = new PublicKey(PublicKey.findProgramAddressSync([Buffer.from("bin_array"),
      new PublicKey(pair.address).toBuffer(), le], new PublicKey(pair.owner))[0]).toBase58() as Address;
    const data = new Uint8Array(10_136); data.set([92, 142, 92, 220, 5, 148, 70, 181]); data[16] = 1;
    const view = new DataView(data.buffer); view.setBigInt64(8, BigInt(index), true); data.set(addressBytes(pair.address), 24);
    for (const [id, x, y] of [[activeId - 1, 0n, 1_000_000_000n], [activeId, 10_000n, 10_000n], [activeId + 1, 1_000_000_000n, 0n]] as const) {
      if (Math.floor(id / 70) !== index) continue;
      const offset = 56 + (id - index * 70) * 144;
      view.setBigUint64(offset, x, true); view.setBigUint64(offset + 8, y, true);
      if (id === activeId) { const price = meteoraDlmmPriceFromIdX64(activeId, 50);
        view.setBigUint64(offset + 16, price & (Q64 - 1n), true); view.setBigUint64(offset + 24, price >> 64n, true); }
    }
    return { address: binAddress, owner: pair.owner, executable: false, data };
  }) as [MimirBetaCapturedAccount, MimirBetaCapturedAccount, MimirBetaCapturedAccount];
  const input = { ...fixture.input, accounts: fixture.input.accounts.map((row) => arrays.find((a) => a.address === row.address) ?? row) };
  const direct = await decodeMimirBetaCaptureCandidate(input);
  const args = { pool: pair.address, pair, ...fixture.input.pair, binArrays: arrays };
  const price = meteoraDlmmPriceFromIdX64(activeId, 50);
  const expected = reverseStorage ? (1_000_010_000n * (Q64 * Q64 / price) / Q64) : 1_000_010_000n;
  assert.equal(await mimirBetaDlmmRouteableLegacyDepth(args), expected);
  if (activeId === 0) assert.equal(direct.minDepthTo50BpsNative, 10_000n);
  for (const mutate of [
    (a: MimirBetaCapturedAccount) => ({ ...a, owner: fixtureAddress(242) }),
    (a: MimirBetaCapturedAccount) => ({ ...a, executable: true }),
    (a: MimirBetaCapturedAccount) => ({ ...a, data: a.data.slice(1) }),
    (a: MimirBetaCapturedAccount) => { const data = a.data.slice(); data[0] ^= 1; return { ...a, data }; },
    (a: MimirBetaCapturedAccount) => { const data = a.data.slice(); data[8] ^= 1; return { ...a, data }; },
    (a: MimirBetaCapturedAccount) => { const data = a.data.slice(); data[24] ^= 1; return { ...a, data }; },
    (a: MimirBetaCapturedAccount) => { const data = a.data.slice(); data[16] = 0; return { ...a, data }; },
    (a: MimirBetaCapturedAccount) => { const data = a.data.slice(); data[17] = 1; return { ...a, data }; },
  ]) {
    await assert.rejects(mimirBetaDlmmRouteableLegacyDepth({ ...args, binArrays: [arrays[0], arrays[1], mutate(arrays[2])] }),
      "unused upper neighbor must still authenticate");
  }
  await assert.rejects(mimirBetaDlmmRouteableLegacyDepth({ ...args, binArrays: [arrays[0], arrays[1], arrays[1]] }));
  await assert.rejects(mimirBetaDlmmRouteableLegacyDepth({ ...args, baseMint: fixtureAddress(242) }));
}

// Edge arrays (program fix-edge): the out-of-domain neighbour is its exact absent PDA; a full 50 bps interval outside the venue
// domain is depth 0 / DEPTH_BELOW_FLOOR; an interval inside it keeps its depth; a real array at the out-of-domain role is refused.
for (const [family, sqrtAt, tick, spacing, outer, inDomain] of [
  ["orca-whirlpool", 65, -443_550, 64, 0, false], ["orca-whirlpool", 65, 443_550, 64, 2, false],
  ["raydium-clmm", 253, -443_630, 1, 0, false], ["raydium-clmm", 253, 443_630, 1, 2, false],
  ["orca-whirlpool", 65, -443_521, 4, 0, true],
] as const) {
  for (const curveLiquidity of [0n, inDomain ? 1n << 60n : 1_000_000_000_000n]) {
    const raw = await makeBetaCaptureFixture(family, { seed: 230, currentTick: tick, tickSpacing: spacing, curveLiquidity });
    const primary = { ...poolRow(raw), data: poolRow(raw).data.slice() };
    const sqrt = (family === "orca-whirlpool" ? orcaSqrtPriceX64FromTickIndex : raydiumSqrtPriceX64FromTickIndex)(tick);
    for (let i = 0; i < 16; i += 1) primary.data[sqrtAt + i] = Number((sqrt >> BigInt(8 * i)) & 0xffn);
    const fixture = { ...raw, input: { ...raw.input, expectedPlan: planFor(raw, raw.input.pair, primary),
      accounts: raw.input.accounts.map((row) => row.address === primary.address ? primary : row) } };
    const nodes = fixture.input.expectedPlan.auxiliary.filter((node) => node.role.startsWith("tick-array-"));
    const node = nodes.find((n) => n.role === (["tick-array-lower", "tick-array-active", "tick-array-upper"] as const)[outer])!;
    const name = `${family} ${tick} L=${curveLiquidity}`;
    await rejects(fixture.input, ["POOL_INELIGIBLE"]);
    const absent = replaceRow(fixture, node.address, (row) => ({ ...row, owner: MIMIR_BETA_SYSTEM_PROGRAM_ID, executable: false, data: new Uint8Array() }));
    const c = await decodeMimirBetaCaptureCandidate(absent);
    if (inDomain && curveLiquidity > 0n) assert.ok(c.minDepthTo50BpsNative > 0n, name);
    else { assert.equal(c.minDepthTo50BpsNative, 0n, name); assert.equal(c.conditions! & MIMIR_COND.DEPTH_BELOW_FLOOR, MIMIR_COND.DEPTH_BELOW_FLOOR, name); }
    await rejects({ ...absent, accounts: absent.accounts.map((row) => row.address === node.address ? { ...row, address: fixtureAddress(246) } : row) },
      ["CAPTURE_PLAN_MISMATCH", "PDA_MISMATCH"]);
    const active = nodes.find((n) => n.role === "tick-array-active")!;
    await rejects(replaceRow({ ...fixture, input: absent }, active.address, (row) => ({ ...row, data: Uint8Array.from(row.data).fill(9, 8, 12) })));
  }
}
console.log("beta capture edge-array tests passed");
