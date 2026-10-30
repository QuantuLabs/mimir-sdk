import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  FEED_SNAPSHOT_MIN_HEADER_LEN,
  FEED_TWAP_HEADER_LEN,
  MIMIR_PROGRAM_ID,
  ORACLE_REGISTRY_HEADER_LEN,
  SOURCE_CONFIG_HEADER_LEN,
  SOURCING_PLAN_HEADER_LEN,
} from "../src/constants.js";

const LOCALNET_FIXTURE_UPSERT_SNAPSHOT_TAG = 1;
const LOCALNET_FIXTURE_UPSERT_REGISTRY_TAG = 3;
const LOCALNET_FIXTURE_UPSERT_SOURCING_PLAN_TAG = 4;
const LOCALNET_FIXTURE_UPSERT_SOURCE_CONFIG_TAG = 5;
const LOCALNET_FIXTURE_UPSERT_FEED_TWAP_TAG = 6;

type LocalnetFixtureCluster = "localnet";

interface LocalnetFixtureGuard {
  cluster: LocalnetFixtureCluster;
}

function assertLocalnetFixtureAllowed(args: LocalnetFixtureGuard): void {
  if (
    args.cluster !== "localnet" ||
    process.env.MIMIR_ALLOW_UNVERIFIED_TEST_FIXTURES !== "1"
  ) {
    throw new Error("UnsafeFixtureRequiresLocalnetEnv");
  }
}

export function encodeLocalnetFixtureUpsertSnapshotData(
  snapshotHeader: Uint8Array,
): Buffer {
  if (snapshotHeader.length !== FEED_SNAPSHOT_MIN_HEADER_LEN) {
    throw new Error("InvalidSnapshotHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([LOCALNET_FIXTURE_UPSERT_SNAPSHOT_TAG]),
    Buffer.from(snapshotHeader),
  ]);
}

export function createLocalnetFixtureUpsertSnapshotInstruction(args: {
  payer: PublicKey;
  snapshot: PublicKey;
  snapshotHeader: Uint8Array;
  cluster: LocalnetFixtureCluster;
  programId?: PublicKey;
}): TransactionInstruction {
  assertLocalnetFixtureAllowed(args);
  return new TransactionInstruction({
    programId: args.programId ?? MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.snapshot, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeLocalnetFixtureUpsertSnapshotData(args.snapshotHeader),
  });
}

export function encodeLocalnetFixtureUpsertRegistryData(
  registryHeader: Uint8Array,
): Buffer {
  if (registryHeader.length !== ORACLE_REGISTRY_HEADER_LEN) {
    throw new Error("InvalidRegistryHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([LOCALNET_FIXTURE_UPSERT_REGISTRY_TAG]),
    Buffer.from(registryHeader),
  ]);
}

export function createLocalnetFixtureUpsertRegistryInstruction(args: {
  payer: PublicKey;
  registry: PublicKey;
  registryHeader: Uint8Array;
  cluster: LocalnetFixtureCluster;
  programId?: PublicKey;
}): TransactionInstruction {
  assertLocalnetFixtureAllowed(args);
  return new TransactionInstruction({
    programId: args.programId ?? MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.registry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeLocalnetFixtureUpsertRegistryData(args.registryHeader),
  });
}

export function encodeLocalnetFixtureUpsertSourcingPlanData(
  sourcingPlanHeader: Uint8Array,
): Buffer {
  if (sourcingPlanHeader.length !== SOURCING_PLAN_HEADER_LEN) {
    throw new Error("InvalidSourcingPlanHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([LOCALNET_FIXTURE_UPSERT_SOURCING_PLAN_TAG]),
    Buffer.from(sourcingPlanHeader),
  ]);
}

export function createLocalnetFixtureUpsertSourcingPlanInstruction(args: {
  payer: PublicKey;
  sourcingPlan: PublicKey;
  sourcingPlanHeader: Uint8Array;
  cluster: LocalnetFixtureCluster;
  programId?: PublicKey;
}): TransactionInstruction {
  assertLocalnetFixtureAllowed(args);
  return new TransactionInstruction({
    programId: args.programId ?? MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.sourcingPlan, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeLocalnetFixtureUpsertSourcingPlanData(args.sourcingPlanHeader),
  });
}

export function encodeLocalnetFixtureUpsertSourceConfigData(
  sourceConfigHeader: Uint8Array,
): Buffer {
  if (sourceConfigHeader.length !== SOURCE_CONFIG_HEADER_LEN) {
    throw new Error("InvalidSourceConfigHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([LOCALNET_FIXTURE_UPSERT_SOURCE_CONFIG_TAG]),
    Buffer.from(sourceConfigHeader),
  ]);
}

export function createLocalnetFixtureUpsertSourceConfigInstruction(args: {
  payer: PublicKey;
  sourceConfig: PublicKey;
  sourceConfigHeader: Uint8Array;
  cluster: LocalnetFixtureCluster;
  programId?: PublicKey;
}): TransactionInstruction {
  assertLocalnetFixtureAllowed(args);
  return new TransactionInstruction({
    programId: args.programId ?? MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.sourceConfig, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeLocalnetFixtureUpsertSourceConfigData(args.sourceConfigHeader),
  });
}

export function encodeLocalnetFixtureUpsertFeedTwapData(
  feedTwapHeader: Uint8Array,
): Buffer {
  if (feedTwapHeader.length !== FEED_TWAP_HEADER_LEN) {
    throw new Error("InvalidFeedTwapHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([LOCALNET_FIXTURE_UPSERT_FEED_TWAP_TAG]),
    Buffer.from(feedTwapHeader),
  ]);
}

export function createLocalnetFixtureUpsertFeedTwapInstruction(args: {
  payer: PublicKey;
  feedTwap: PublicKey;
  feedTwapHeader: Uint8Array;
  cluster: LocalnetFixtureCluster;
  programId?: PublicKey;
}): TransactionInstruction {
  assertLocalnetFixtureAllowed(args);
  return new TransactionInstruction({
    programId: args.programId ?? MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.feedTwap, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeLocalnetFixtureUpsertFeedTwapData(args.feedTwapHeader),
  });
}
