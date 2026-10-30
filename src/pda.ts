import { Buffer } from "buffer";
import { PublicKey } from "@solana/web3.js";
import {
  MAX_SOURCE_INDEX,
  PROTOCOL_TREASURY_SEED,
} from "./constants.js";
import { freshCanonicalAuthority } from "./internal/canonicalAuthority.js";

const {
  MIMIR_PROGRAM_ID: CANONICAL_MIMIR_PROGRAM_ID,
  METEORA_DLMM_PROGRAM_ID,
  RAYDIUM_CPMM_OBSERVATION_SEED,
  SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
  SPL_TOKEN_PROGRAM_ID: CANONICAL_SPL_TOKEN_PROGRAM_ID,
} = freshCanonicalAuthority(PublicKey);

function assertFeedId(feedId: Uint8Array): void {
  if (feedId.length !== 32) throw new Error("Expected32Bytes");
  for (const byte of feedId) {
    if (byte !== 0) return;
  }
  throw new Error("InvalidFeedId");
}

function assertSourceIndex(sourceIndex: number): void {
  if (
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex > MAX_SOURCE_INDEX
  ) {
    throw new Error("InvalidSourceIndex");
  }
}

function assertU16(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    throw new Error(name);
  }
}

function u16Le(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

const pdaCache = new Map<string, [PublicKey, number]>();

function pdaSeedKey(seed: Uint8Array): string {
  return Buffer.from(seed.buffer, seed.byteOffset, seed.byteLength).toString("hex");
}

export function findProgramAddressCached(
  seeds: readonly Uint8Array[],
  programId: PublicKey,
): [PublicKey, number] {
  const key = `${programId.toBase58()}|${seeds.map(pdaSeedKey).join("|")}`;
  const cached = pdaCache.get(key);
  if (cached) return [new PublicKey(cached[0].toBytes()), cached[1]];
  const derived = PublicKey.findProgramAddressSync([...seeds], programId);
  if (pdaCache.size >= 4096) pdaCache.clear();
  pdaCache.set(key, [new PublicKey(derived[0].toBytes()), derived[1]]);
  return [derived[0], derived[1]];
}

export function findFeedConfigPda(feedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(feedId);
  return findProgramAddressCached([Buffer.from("feed_config"), Buffer.from(feedId)], programId);
}

export function findFeedReservationPda(feedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(feedId);
  return findProgramAddressCached([Buffer.from("feed_reservation"), Buffer.from(feedId)], programId);
}

export function findFeedCollateralLockPda(feedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(feedId);
  return findProgramAddressCached([Buffer.from("feed_collateral_lock"), Buffer.from(feedId)], programId);
}

export function findAssociatedTokenAccountPda(
  owner: PublicKey,
  mint: PublicKey,
  tokenProgram = CANONICAL_SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgram = SPL_ASSOCIATED_TOKEN_PROGRAM_ID,
): [PublicKey, number] {
  return findProgramAddressCached(
    [owner.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()],
    associatedTokenProgram,
  );
}

export function findFeedFeeVaultPda(feedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(feedId);
  return findProgramAddressCached([Buffer.from("feed_fee_vault"), Buffer.from(feedId)], programId);
}

export function findCompositeFeedConfigPda(compositeFeedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(compositeFeedId);
  return findProgramAddressCached(
    [Buffer.from("composite_feed_config"), Buffer.from(compositeFeedId)],
    programId,
  );
}

export function findCompositeSnapshotPda(compositeFeedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(compositeFeedId);
  return findProgramAddressCached(
    [Buffer.from("composite_snapshot"), Buffer.from(compositeFeedId)],
    programId,
  );
}

export function findFeedSnapshotPda(feedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(feedId);
  return findProgramAddressCached([Buffer.from("feed_snapshot"), Buffer.from(feedId)], programId);
}

export function findOracleRegistryPda(
  registryVersion = 0,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  return findProgramAddressCached(
    [Buffer.from("mimir_registry"), u16Le(registryVersion)],
    programId,
  );
}

export function findProtocolTreasuryPda(
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  return findProgramAddressCached(
    [Buffer.from(PROTOCOL_TREASURY_SEED), u16Le(1)],
    programId,
  );
}

export function findAdminConfigPda(
  configVersion = 1,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  if (configVersion !== 1) throw new Error("UnsupportedAdminConfigVersion");
  return findProgramAddressCached(
    [Buffer.from("admin_config"), u16Le(configVersion)],
    programId,
  );
}

export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export function findMimirProgramDataAddress(
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
  )[0];
}

export function findGovernancePolicyPda(
  policyVersion = 0,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  return findProgramAddressCached(
    [Buffer.from("governance_policy"), u16Le(policyVersion)],
    programId,
  );
}

export function findGovernanceActionPda(
  actionHash: Uint8Array,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  if (actionHash.length !== 32) throw new Error("Expected32Bytes");
  return findProgramAddressCached(
    [Buffer.from("governance_action"), Buffer.from(actionHash)],
    programId,
  );
}

export function findSourcingPlanPda(
  feedId: Uint8Array,
  planId: number,
  planVersion: number,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  assertFeedId(feedId);
  assertU16(planId, "InvalidPlanId");
  assertU16(planVersion, "InvalidPlanVersion");
  return findProgramAddressCached(
    [Buffer.from("sourcing_plan"), Buffer.from(feedId), u16Le(planId), u16Le(planVersion)],
    programId,
  );
}

export function findSourceConfigPda(
  feedId: Uint8Array,
  sourceIndex: number,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  assertFeedId(feedId);
  assertSourceIndex(sourceIndex);
  return findProgramAddressCached(
    [Buffer.from("source_config"), Buffer.from(feedId), Buffer.from([sourceIndex])],
    programId,
  );
}

/** Reserved address in the activation account list; never allocated by mainnet v1 activation. */
export function findFeedTwapPda(
  feedId: Uint8Array,
  twapVersion = 0,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  assertFeedId(feedId);
  assertU16(twapVersion, "InvalidTwapVersion");
  return findProgramAddressCached(
    [Buffer.from("feed_twap"), Buffer.from(feedId), u16Le(twapVersion)],
    programId,
  );
}

/** Reserved address in the activation account list; never allocated by mainnet v1 activation. */
export function findSourceRingPda(
  feedId: Uint8Array,
  sourceIndex: number,
  ringVersion = 0,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  assertFeedId(feedId);
  assertSourceIndex(sourceIndex);
  assertU16(ringVersion, "InvalidRingVersion");
  return findProgramAddressCached(
    [Buffer.from("source_ring"), Buffer.from(feedId), Buffer.from([sourceIndex]), u16Le(ringVersion)],
    programId,
  );
}

export function findSourceTemporalPda(
  feedId: Uint8Array,
  sourceIndex: number,
  moduleVersion = 1,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  assertFeedId(feedId);
  assertSourceIndex(sourceIndex);
  if (moduleVersion !== 1 && moduleVersion !== 2 && moduleVersion !== 3 && moduleVersion !== 4) throw new Error("UnsupportedSourceTemporalModuleVersion");
  return findProgramAddressCached(
    [Buffer.from("source_temporal"), Buffer.from(feedId), Buffer.from([sourceIndex]), u16Le(moduleVersion)],
    programId,
  );
}

export function findOnlyBWitnessPda(feedId: Uint8Array, programId = CANONICAL_MIMIR_PROGRAM_ID): [PublicKey, number] {
  assertFeedId(feedId);
  return findProgramAddressCached([Buffer.from("onlyb_witness"), Buffer.from(feedId)], programId);
}

/** Reserved address in the activation account list; never allocated by mainnet v1 activation. */
export function findNativeTwapProofPda(
  feedId: Uint8Array,
  twapVersion: number,
  sourceIndex: number,
  observationState: PublicKey,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): [PublicKey, number] {
  assertFeedId(feedId);
  assertU16(twapVersion, "InvalidTwapVersion");
  assertSourceIndex(sourceIndex);
  return findProgramAddressCached(
    [
      Buffer.from("native_twap_proof"),
      Buffer.from(feedId),
      u16Le(twapVersion),
      Buffer.from([sourceIndex]),
      observationState.toBuffer(),
    ],
    programId,
  );
}

export function findRaydiumCpmmObservationStatePda(
  poolState: PublicKey,
  cpmmProgramId: PublicKey,
): [PublicKey, number] {
  return findProgramAddressCached(
    [RAYDIUM_CPMM_OBSERVATION_SEED, poolState.toBuffer()],
    cpmmProgramId,
  );
}

export function findMeteoraDlmmObservationStatePda(
  pool: PublicKey,
): [PublicKey, number] {
  return findProgramAddressCached(
    [Buffer.from("oracle"), pool.toBuffer()],
    METEORA_DLMM_PROGRAM_ID,
  );
}
