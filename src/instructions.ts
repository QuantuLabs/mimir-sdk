import {
  PublicKey,
  TransactionInstruction as Web3TransactionInstruction,
  type AccountMeta,
} from "@solana/web3.js";
import { createHash } from "./internal/sha256.js";
import { mixedExecutionNativeTailWidth } from "./internal/mixedExecutionTail.js";
export { mixedExecutionNativeTailWidth };
import {
  ADMIN_CONFIG_OFFSETS,
  ADMIN_MAX_COMPOSITE_REFRESH_FEE_LAMPORTS,
  APPROVE_GOVERNANCE_ACTION_LEN,
  APPROVE_GOVERNANCE_ACTION_TAG,
  CLAIM_REFRESH_FEES_V1_LEN,
  CLAIM_REFRESH_FEES_V1_TAG,
  WITHDRAW_PROTOCOL_TREASURY_V1_TAG,
  WITHDRAW_PROTOCOL_TREASURY_V1_LEN,
  CLOSE_STALE_PROOF_OR_BUCKET_V1_LEN,
  CLOSE_STALE_PROOF_OR_BUCKET_V1_TAG,
  COMPOSITE_COMPONENT_CONFIG_LEN,
  COMPOSITE_FEED_CONFIG_HEADER_LEN,
  CREATE_GOVERNANCE_ACTION_TAG,
  GOVERNANCE_ACTION_HEADER_LEN,
  GOVERNANCE_POLICY_HEADER_LEN,
  ORACLE_REGISTRY_HEADER_LEN,
  RECLAIM_FEED_RESERVATION_LEN,
  RECLAIM_FEED_RESERVATION_TAG,
  UPSERT_GOVERNANCE_POLICY_TAG,
  UPSERT_ADMIN_CONFIG_V1_LEN,
  UPSERT_ADMIN_CONFIG_V1_TAG,
  UPSERT_REGISTRY_TAG,
  VERIFY_SNAPSHOT_MODE_MINIMUM,
  VERIFY_SNAPSHOT_TAG,
  MAX_TWAP_AGGREGATION_SOURCES,
  MAX_COMPOSITE_COMPONENTS,
  MIN_COMPOSITE_COMPONENTS,
  isMimirAdmittedQuoteMint,
  resolveMimirProgramProfile,
  type MimirCluster,
} from "./constants.js";
import {
  freshCanonicalAuthority,
  freshPublicKey,
} from "./internal/canonicalAuthority.js";
import {
  decodeAdminConfigHeader,
} from "./codec.js";
import { Q64 } from "./math.js";
import {
  findCompositeFeedConfigPda,
  findAdminConfigPda,
  findMimirProgramDataAddress,
  findProtocolTreasuryPda,
  findFeedFeeVaultPda,
} from "./pda.js";
import type {
  ClaimRefreshFeesV1Args,
  CreateCompositeFeedConfigV1Args,
  SnapshotPolicy,
} from "./types.js";

const {
  MIMIR_PROGRAM_ID: CANONICAL_MIMIR_PROGRAM_ID,
  MIMIR_SOL_MINT,
  COMPOSITE_COMPONENT_OFFSETS,
  COMPOSITE_CONFIG_OFFSETS,
  COMPOSITE_FEED_CONFIG_MAGIC,
  RouteabilityStatus,
  RiskTier,
  VerifyFlags,
  SYSTEM_PROGRAM_ID,
} = freshCanonicalAuthority(PublicKey);

class TransactionInstruction extends Web3TransactionInstruction {
  constructor(opts: {
    keys: AccountMeta[];
    programId: PublicKey;
    data?: Buffer;
  }) {
    super({
      keys: opts.keys.map((meta) => ({
        pubkey: new PublicKey(meta.pubkey.toBytes()),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
      })),
      programId: new PublicKey(opts.programId.toBytes()),
      data: opts.data ? Buffer.from(opts.data) : undefined,
    });
  }
}

function tokenProgramId(programId?: PublicKey): PublicKey {
  return programId
    ? new PublicKey(programId.toBytes())
    : freshPublicKey("SPL_TOKEN", PublicKey);
}

export interface CompositeSumOfPricesComponentInput {
  feedId: Uint8Array;
  sourceConfig: Uint8Array;
  quantityX64?: bigint;
}

export interface BuildCompositeSumOfPricesConfigArgs
  extends Omit<CreateCompositeFeedConfigV1Args, "components"> {
  components: readonly CompositeSumOfPricesComponentInput[];
}

export interface ApproveGovernanceActionArgs {
  actionHash: Uint8Array;
  expectedActionRevision: bigint;
}

export interface FeedCreationCollateralAccountMetasArgs {
  feedCollateralLock: PublicKey;
  creatorCollateralTokenAccount: PublicKey;
  collateralMint: PublicKey;
  tokenProgram?: PublicKey;
}

export function createFeedCreationCollateralAccountMetas(
  args: FeedCreationCollateralAccountMetasArgs,
): AccountMeta[] {
  const tokenProgram = tokenProgramId(args.tokenProgram);
  if (!tokenProgram.equals(freshPublicKey("SPL_TOKEN", PublicKey))) {
    throw new Error("InvalidFeedCollateralTokenProgram");
  }
  return [
    { pubkey: args.feedCollateralLock, isSigner: false, isWritable: true },
    {
      pubkey: args.creatorCollateralTokenAccount,
      isSigner: false,
      isWritable: true,
    },
    { pubkey: args.collateralMint, isSigner: false, isWritable: true },
    { pubkey: tokenProgram, isSigner: false, isWritable: false },
  ];
}

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

function isU16(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function assertU8(value: number, name: string, min = 0): void {
  if (!Number.isInteger(value) || value < min || value > 0xff) {
    throw new Error(name);
  }
}

function assertAggregationSourceCount(value: number, name: string): void {
  assertU8(value, name, 1);
  if (value > MAX_TWAP_AGGREGATION_SOURCES) {
    throw new Error(name);
  }
}

function assertOptionalAggregationCount(value: number, name: string): void {
  assertU8(value, name);
  if (value > MAX_TWAP_AGGREGATION_SOURCES) {
    throw new Error(name);
  }
}

function assertBps(value: number, name: string): void {
  if (!isU16(value) || value === 0 || value > 10_000) {
    throw new Error(name);
  }
}

function isZero32(value: Uint8Array): boolean {
  for (const byte of value) {
    if (byte !== 0) return false;
  }
  return true;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function putBytes(out: Buffer, offset: number, value: Uint8Array): number {
  if (value.length !== 32) throw new Error("Expected32Bytes");
  Buffer.from(value).copy(out, offset);
  return offset + 32;
}

function putU128(out: Buffer, offset: number, value: bigint): number {
  out.writeBigUInt64LE(value & ((1n << 64n) - 1n), offset);
  out.writeBigUInt64LE(value >> 64n, offset + 8);
  return offset + 16;
}

export function encodeVerifySnapshotData(policy: SnapshotPolicy): Buffer {
  if (
    policy.expectedTwapRevision !== 0n &&
    (policy.flags & VerifyFlags.RequireLiveTwapState) === 0
  ) {
    throw new Error("InvalidSnapshotPolicy");
  }
  if (
    policy.expectedSnapshotRevision === 0n ||
    ((policy.flags & VerifyFlags.RequireLiveTwapState) !== 0 &&
      policy.expectedTwapRevision === 0n) ||
    policy.expectedRouteabilityStatus === RouteabilityStatus.Unrated ||
    policy.expectedRouteabilityStatus === RouteabilityStatus.Disabled
  ) {
    throw new Error("InvalidSnapshotPolicy");
  }
  if (
    (policy.flags & VerifyFlags.RequireLiveTwapState) !== 0 &&
    (policy.flags & VerifyFlags.RequireLiveSourcingPlan) === 0
  ) {
    throw new Error("InvalidSnapshotPolicy");
  }
  assertAggregationSourceCount(policy.minSourceCount, "InvalidSnapshotPolicy");
  assertOptionalAggregationCount(policy.minVenueCount, "InvalidSnapshotPolicy");
  assertOptionalAggregationCount(
    policy.minCorrelationGroupCount,
    "InvalidSnapshotPolicy",
  );
  assertU8(policy.expectedRouteabilityStatus, "InvalidSnapshotPolicy");
  assertU8(policy.flags, "InvalidSnapshotPolicy");
  assertBps(policy.minCoverageRatioBps, "InvalidSnapshotPolicy");
  assertBps(policy.maxConfidenceBps, "InvalidSnapshotPolicy");
  assertBps(policy.maxDispersionBps, "InvalidSnapshotPolicy");
  if (
    policy.expectedFeedId.length !== 32 ||
    isZero32(policy.expectedFeedId) ||
    policy.expectedPlanHash.length !== 32 ||
    isZero32(policy.expectedPlanHash) ||
    policy.expectedAnchorPolicyHash.length !== 32 ||
    isZero32(policy.expectedAnchorPolicyHash) ||
    !isU16(policy.maxSnapshotAgeSlots) ||
    policy.maxSnapshotAgeSlots === 0 ||
    !isU16(policy.maxSourceActivityAgeSlots) ||
    policy.maxSourceActivityAgeSlots === 0
  ) {
    throw new Error("InvalidSnapshotPolicy");
  }
  const out = Buffer.alloc(
    1 +
      32 +
      4 +
      32 +
      32 +
      32 +
      8 +
      2 +
      2 +
      1 +
      1 +
      1 +
      2 +
      2 +
      2 +
      16 +
      8 +
      8 +
      1 +
      1 +
      (policy.minimumRevision === true ? 1 : 0),
  );
  let offset = 0;
  out[offset] = VERIFY_SNAPSHOT_TAG;
  offset += 1;
  offset = putBytes(out, offset, policy.expectedFeedId);
  out.writeInt32LE(policy.expectedPriceExponent, offset);
  offset += 4;
  offset = putBytes(out, offset, policy.expectedPlanHash);
  offset = putBytes(out, offset, policy.expectedAnchorPolicyHash);
  offset = putBytes(out, offset, policy.expectedNativeExceptionHash);
  out.writeBigUInt64LE(policy.clockSlot, offset);
  offset += 8;
  out.writeUInt16LE(policy.maxSnapshotAgeSlots, offset);
  offset += 2;
  out.writeUInt16LE(policy.maxSourceActivityAgeSlots, offset);
  offset += 2;
  out.writeUInt8(policy.minSourceCount, offset);
  offset += 1;
  out.writeUInt8(policy.minVenueCount, offset);
  offset += 1;
  out.writeUInt8(policy.minCorrelationGroupCount, offset);
  offset += 1;
  out.writeUInt16LE(policy.minCoverageRatioBps, offset);
  offset += 2;
  out.writeUInt16LE(policy.maxConfidenceBps, offset);
  offset += 2;
  out.writeUInt16LE(policy.maxDispersionBps, offset);
  offset += 2;
  out.writeBigUInt64LE(policy.notional & ((1n << 64n) - 1n), offset);
  out.writeBigUInt64LE(policy.notional >> 64n, offset + 8);
  offset += 16;
  out.writeBigUInt64LE(policy.expectedSnapshotRevision, offset);
  offset += 8;
  out.writeBigUInt64LE(policy.expectedTwapRevision, offset);
  offset += 8;
  out.writeUInt8(policy.expectedRouteabilityStatus, offset);
  offset += 1;
  out.writeUInt8(policy.flags, offset);
  if (policy.minimumRevision === true) out.writeUInt8(VERIFY_SNAPSHOT_MODE_MINIMUM, offset + 1);
  return out;
}

/** Tag-0 minimum-mode return data: the observation the program actually accepted. */
export function decodeVerifySnapshotReturnData(data: Uint8Array): {
  snapshotRevision: bigint;
  snapshotSlot: bigint;
  twapRevision: bigint;
} {
  if (data.length !== 24) throw new Error("InvalidVerifySnapshotReturnData");
  const view = new DataView(data.buffer, data.byteOffset, 24);
  return {
    snapshotRevision: view.getBigUint64(0, true),
    snapshotSlot: view.getBigUint64(8, true),
    twapRevision: view.getBigUint64(16, true),
  };
}

export function createVerifySnapshotInstruction(args: {
  snapshot: PublicKey;
  feedConfig?: PublicKey;
  registry?: PublicKey;
  sourcingPlan?: PublicKey;
  feedTwap?: PublicKey;
  policy: SnapshotPolicy;
  programId?: PublicKey;
}): TransactionInstruction {
  const keys = [{ pubkey: args.snapshot, isSigner: false, isWritable: false }];
  if ((args.policy.flags & VerifyFlags.RequireLiveFeedConfig) !== 0) {
    if (!args.feedConfig) throw new Error("MissingFeedConfig");
    keys.push({ pubkey: args.feedConfig, isSigner: false, isWritable: false });
  }
  if ((args.policy.flags & VerifyFlags.RequireLiveRegistry) !== 0) {
    if (!args.registry) throw new Error("MissingRegistry");
    keys.push({ pubkey: args.registry, isSigner: false, isWritable: false });
  }
  if ((args.policy.flags & VerifyFlags.RequireLiveSourcingPlan) !== 0) {
    if (!args.sourcingPlan) throw new Error("MissingSourcingPlan");
    keys.push({
      pubkey: args.sourcingPlan,
      isSigner: false,
      isWritable: false,
    });
  }
  if ((args.policy.flags & VerifyFlags.RequireLiveTwapState) !== 0) {
    if (!args.feedTwap) throw new Error("MissingFeedTwap");
    keys.push({ pubkey: args.feedTwap, isSigner: false, isWritable: false });
  }
  return new TransactionInstruction({
    programId: args.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
    keys,
    data: encodeVerifySnapshotData(args.policy),
  });
}

export function createUpsertAdminConfigV1Instruction(args: {
  payer: PublicKey;
  authority: PublicKey;
  adminConfig: PublicKey;
  adminConfigHeader: Uint8Array;
  authorityRole?: "admin" | "upgradeAuthority";
  currentAdminConfigHeader?: Uint8Array;
  cluster?: MimirCluster;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  const { cluster } = resolveMimirProgramProfile({ cluster: args.cluster, programId });
  const role = args.authorityRole ?? "admin";
  if (role !== "admin" && role !== "upgradeAuthority") {
    throw new Error("InvalidAuthorityRole");
  }
  if (args.adminConfigHeader.length !== UPSERT_ADMIN_CONFIG_V1_LEN) {
    throw new Error("InvalidAdminConfigHeaderLength");
  }
  const header = decodeAdminConfigHeader(args.adminConfigHeader);
  const [expectedAdminConfig, expectedBump] = findAdminConfigPda(1, programId);
  if (!args.adminConfig.equals(expectedAdminConfig)) {
    throw new Error("InvalidAdminConfigAddress");
  }
  if (
    role === "admin" &&
    !sameBytes(header.adminAuthority, args.authority.toBytes())
  ) {
    throw new Error("InvalidGovernanceAuthority");
  }
  if (header.bump !== expectedBump) {
    throw new Error("InvalidAdminConfigAddress");
  }
  const current = args.currentAdminConfigHeader
    ? decodeAdminConfigHeader(args.currentAdminConfigHeader)
    : undefined;
  const legacyBinding =
    role === "admin" &&
    current !== undefined &&
    !sameBytes(header.adminAuthority, current.adminAuthority);
  const bounded =
    cluster !== "localnet" &&
    (role === "admin"
      ? !legacyBinding
      : current === undefined && header.configRevision === 1n);
  if (bounded) {
    const base = header.feedCreationCollateralAmountRaw;
    if (
      header.compositeRefreshFeeLamports > ADMIN_MAX_COMPOSITE_REFRESH_FEE_LAMPORTS ||
      header.compositeOwnerShareBps > 10_000 ||
      base === 0n ||
      base % 10n !== 0n ||
      base > 1_000_000_000_000_000n
    ) {
      throw new Error("InvalidAdminConfig");
    }
  }
  if (current && args.currentAdminConfigHeader) {
    if (role === "admin") {
      if (
        !legacyBinding &&
        current.compositeRefreshFeeLamports === header.compositeRefreshFeeLamports &&
        current.compositeOwnerShareBps === header.compositeOwnerShareBps &&
        current.feedCreationCollateralAmountRaw === header.feedCreationCollateralAmountRaw &&
        Buffer.from(args.currentAdminConfigHeader).subarray(104, 120)
          .equals(Buffer.from(args.adminConfigHeader).subarray(104, 120)) &&
        current.closePower === header.closePower &&
        current.creationOpen === header.creationOpen
      ) {
        throw new Error("AdminConfigNoOp");
      }
    } else {
      const expected = Buffer.from(args.currentAdminConfigHeader);
      Buffer.from(header.adminAuthority).copy(expected, ADMIN_CONFIG_OFFSETS.adminAuthority);
      expected.writeBigUInt64LE(current.configRevision + 1n, ADMIN_CONFIG_OFFSETS.configRevision);
      if (sameBytes(header.adminAuthority, current.adminAuthority)) {
        throw new Error("AdminConfigNoOp");
      }
      if (!expected.equals(Buffer.from(args.adminConfigHeader))) {
        throw new Error("InvalidAdminRotation");
      }
    }
  }
  const keys = [
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: args.authority, isSigner: true, isWritable: false },
    { pubkey: args.adminConfig, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  if (role === "upgradeAuthority") {
    keys.push({
      pubkey: findMimirProgramDataAddress(programId),
      isSigner: false,
      isWritable: false,
    });
  }
  return new TransactionInstruction({
    programId,
    keys,
    data: Buffer.concat([
      Buffer.from([UPSERT_ADMIN_CONFIG_V1_TAG]),
      Buffer.from(args.adminConfigHeader),
    ]),
  });
}

export function encodeWithdrawProtocolTreasuryV1Data(amountLamports: bigint): Buffer {
  if (amountLamports <= 0n || amountLamports > 0xffff_ffff_ffff_ffffn) {
    throw new Error("InvalidWithdrawAmount");
  }
  const out = Buffer.alloc(1 + WITHDRAW_PROTOCOL_TREASURY_V1_LEN);
  out[0] = WITHDRAW_PROTOCOL_TREASURY_V1_TAG;
  out.writeBigUInt64LE(amountLamports, 1);
  return out;
}

export function createWithdrawProtocolTreasuryV1Instruction(args: {
  governanceAuthority: PublicKey;
  adminConfig: PublicKey;
  protocolTreasury: PublicKey;
  amountLamports: bigint;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  if (!args.adminConfig.equals(findAdminConfigPda(1, programId)[0])) {
    throw new Error("InvalidAdminConfigAddress");
  }
  if (!args.protocolTreasury.equals(findProtocolTreasuryPda(programId)[0])) {
    throw new Error("InvalidProtocolTreasuryAddress");
  }
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: args.governanceAuthority, isSigner: true, isWritable: true },
      { pubkey: args.adminConfig, isSigner: false, isWritable: false },
      { pubkey: args.protocolTreasury, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeWithdrawProtocolTreasuryV1Data(args.amountLamports),
  });
}

export function encodeReclaimFeedReservationData(feedId: Uint8Array): Buffer {
  if (feedId.length !== 32) throw new Error("Expected32Bytes");
  if (isZero32(feedId)) throw new Error("InvalidReclaimFeedReservationArgs");
  const out = Buffer.alloc(1 + RECLAIM_FEED_RESERVATION_LEN);
  out[0] = RECLAIM_FEED_RESERVATION_TAG;
  Buffer.from(feedId).copy(out, 1);
  return out;
}

export function reclaimFeedReservationInstruction(args: {
  authority: PublicKey;
  registry: PublicKey;
  feedReservation: PublicKey;
  feedConfig: PublicKey;
  feedId: Uint8Array;
  programId?: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.authority, isSigner: true, isWritable: true },
      { pubkey: args.registry, isSigner: false, isWritable: false },
      { pubkey: args.feedReservation, isSigner: false, isWritable: true },
      { pubkey: args.feedConfig, isSigner: false, isWritable: false },
    ],
    data: encodeReclaimFeedReservationData(args.feedId),
  });
}

export function encodeClaimRefreshFeesV1Data(args: ClaimRefreshFeesV1Args): Buffer {
  if (args.feedId.length !== 32) throw new Error("Expected32Bytes");
  if (isZero32(args.feedId)) throw new Error("InvalidClaimRefreshFeesArgs");
  assertU64(args.expectedOwnerClaimedLamports, "InvalidClaimRefreshFeesArgs");
  assertU64(args.claimAmountLamports, "InvalidClaimRefreshFeesArgs");
  if (args.claimAmountLamports === 0n) throw new Error("InvalidClaimRefreshFeesArgs");
  const out = Buffer.alloc(1 + CLAIM_REFRESH_FEES_V1_LEN);
  out[0] = CLAIM_REFRESH_FEES_V1_TAG;
  Buffer.from(args.feedId).copy(out, 1);
  out.writeBigUInt64LE(args.expectedOwnerClaimedLamports, 33);
  out.writeBigUInt64LE(args.claimAmountLamports, 41);
  return out;
}

export function createClaimRefreshFeesV1Instruction(args: {
  feedFeeVault?: PublicKey;
  compositeFeedConfig?: PublicKey;
  currentOwner: PublicKey;
  coreAsset: PublicKey;
  claim: ClaimRefreshFeesV1Args;
  programId?: PublicKey;
}): TransactionInstruction {
  const programId = args.programId ?? CANONICAL_MIMIR_PROGRAM_ID;
  const [feedFeeVault] = findFeedFeeVaultPda(args.claim.feedId, programId);
  const [compositeFeedConfig] = findCompositeFeedConfigPda(args.claim.feedId, programId);
  if (args.feedFeeVault != null && !args.feedFeeVault.equals(feedFeeVault)) {
    throw new Error("InvalidFeedFeeVault");
  }
  if (args.compositeFeedConfig != null && !args.compositeFeedConfig.equals(compositeFeedConfig)) {
    throw new Error("InvalidCompositeFeedConfig");
  }
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: args.currentOwner, isSigner: true, isWritable: true },
      { pubkey: compositeFeedConfig, isSigner: false, isWritable: false },
      { pubkey: feedFeeVault, isSigner: false, isWritable: true },
      { pubkey: args.coreAsset, isSigner: false, isWritable: false },
    ],
    data: encodeClaimRefreshFeesV1Data(args.claim),
  });
}

export function encodeCloseStaleProofOrBucketV1Data(): Buffer {
  const out = Buffer.alloc(1 + CLOSE_STALE_PROOF_OR_BUCKET_V1_LEN);
  out[0] = CLOSE_STALE_PROOF_OR_BUCKET_V1_TAG;
  return out;
}

export function createCloseStaleProofOrBucketV1Instruction(args: {
  caller: PublicKey;
  target: PublicKey;
  feedTwap: PublicKey;
  adminConfig: PublicKey;
  recipient: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.caller, isSigner: true, isWritable: false },
      { pubkey: args.target, isSigner: false, isWritable: true },
      { pubkey: args.feedTwap, isSigner: false, isWritable: false },
      { pubkey: args.adminConfig, isSigner: false, isWritable: false },
      { pubkey: args.recipient, isSigner: false, isWritable: true },
    ],
    data: encodeCloseStaleProofOrBucketV1Data(),
  });
}

function hashv(items: readonly Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  for (const item of items) {
    hash.update(Buffer.from(item));
  }
  return hash.digest();
}

function assertU64(value: bigint, name: string): void {
  if (value < 0n || value > U64_MAX) {
    throw new Error(name);
  }
}

function assertU128(value: bigint, name: string): void {
  if (value < 0n || value > U128_MAX) {
    throw new Error(name);
  }
}

function assertPriceExponent(value: number, name: string): void {
  if (!Number.isInteger(value) || value < -36 || value > 36) {
    throw new Error(name);
  }
}

function assertCompositeComponents(
  components: readonly CreateCompositeFeedConfigV1Args["components"][number][],
  _programId = CANONICAL_MIMIR_PROGRAM_ID,
): void {
  if (
    !Number.isInteger(components.length) ||
    components.length < MIN_COMPOSITE_COMPONENTS ||
    components.length > MAX_COMPOSITE_COMPONENTS
  ) {
    throw new Error("InvalidCompositeComponentCount");
  }

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    if (
      component.feedId.length !== 32 ||
      component.sourceConfig.length !== 32 ||
      isZero32(component.feedId) ||
      isZero32(component.sourceConfig)
    ) {
      throw new Error("InvalidCompositeComponent");
    }
    assertU128(component.quantityX64, "InvalidCompositeQuantity");
    if (component.quantityX64 === 0n) {
      throw new Error("InvalidCompositeQuantity");
    }
    for (let previous = 0; previous < index; previous += 1) {
      const prior = components[previous];
      if (
        sameBytes(prior.feedId, component.feedId) ||
        sameBytes(prior.sourceConfig, component.sourceConfig)
      ) {
        throw new Error("DuplicateCompositeComponent");
      }
    }
  }
}

function compareCompositeComponents(
  a: CreateCompositeFeedConfigV1Args["components"][number],
  b: CreateCompositeFeedConfigV1Args["components"][number],
): number {
  const feedDelta = Buffer.from(a.feedId).compare(Buffer.from(b.feedId));
  if (feedDelta !== 0) return feedDelta;
  const sourceDelta = Buffer.from(a.sourceConfig).compare(Buffer.from(b.sourceConfig));
  if (sourceDelta !== 0) return sourceDelta;
  if (a.quantityX64 < b.quantityX64) return -1;
  if (a.quantityX64 > b.quantityX64) return 1;
  return 0;
}

function canonicalCompositeComponents(
  components: readonly CreateCompositeFeedConfigV1Args["components"][number][],
): CreateCompositeFeedConfigV1Args["components"][number][] {
  assertCompositeComponents(components);
  return [...components].sort(compareCompositeComponents);
}

export function buildCompositeSumOfPricesComponents(
  components: readonly CompositeSumOfPricesComponentInput[],
): CreateCompositeFeedConfigV1Args["components"][number][] {
  const normalized = components.map((component) => ({
    feedId: component.feedId,
    sourceConfig: component.sourceConfig,
    quantityX64: component.quantityX64 ?? Q64,
  }));
  return canonicalCompositeComponents(normalized);
}

export function buildCompositeSumOfPricesConfig(
  args: BuildCompositeSumOfPricesConfigArgs,
): CreateCompositeFeedConfigV1Args {
  return {
    ...args,
    components: buildCompositeSumOfPricesComponents(args.components),
  };
}

export function computeCompositeComponentSetHash(
  args: Pick<
    CreateCompositeFeedConfigV1Args,
    "quoteMint" | "solConversionSourceConfig" | "components"
  >,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): Buffer {
  if (args.quoteMint.length !== 32 || isZero32(args.quoteMint)) {
    throw new Error("InvalidCompositeQuoteMint");
  }
  const solConversionSourceConfig =
    args.solConversionSourceConfig ?? Buffer.alloc(32);
  if (solConversionSourceConfig.length !== 32) {
    throw new Error("InvalidCompositeSolConversionSourceConfig");
  }
  const components = canonicalCompositeComponents(args.components);
  const items: Uint8Array[] = [
    Buffer.from("MIMIR_COMPOSITE_COMPONENTS_V1", "ascii"),
    Buffer.from(args.quoteMint),
    Buffer.from([components.length]),
    Buffer.from(solConversionSourceConfig),
  ];
  for (const component of components) {
    const quantity = Buffer.alloc(16);
    putU128(quantity, 0, component.quantityX64);
    items.push(Buffer.from(component.feedId));
    items.push(Buffer.from(component.sourceConfig));
    items.push(quantity);
  }
  return hashv(items);
}

export function deriveCompositeFeedId(
  args: Pick<
    CreateCompositeFeedConfigV1Args,
    "creator" | "quoteMint" | "solConversionSourceConfig" | "priceExponent" | "components"
  >,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): Buffer {
  if (
    args.creator.length !== 32 ||
    args.quoteMint.length !== 32 ||
    (args.solConversionSourceConfig != null &&
      args.solConversionSourceConfig.length !== 32) ||
    isZero32(args.creator) ||
    isZero32(args.quoteMint)
  ) {
    throw new Error("InvalidCompositeFeedConfig");
  }
  assertPriceExponent(args.priceExponent, "InvalidCompositeFeedConfig");
  const componentSetHash = computeCompositeComponentSetHash(args, programId);
  const priceExponent = Buffer.alloc(4);
  priceExponent.writeInt32LE(args.priceExponent, 0);
  return hashv([
    Buffer.from("MIMIR_COMPOSITE_FEED_ID_V1", "ascii"),
    Buffer.from(args.creator),
    Buffer.from(args.quoteMint),
    priceExponent,
    Buffer.from([canonicalCompositeComponents(args.components).length]),
    componentSetHash,
  ]);
}

export function encodeCompositeFeedConfigHeader(
  args: CreateCompositeFeedConfigV1Args,
  programId = CANONICAL_MIMIR_PROGRAM_ID,
): Buffer {
  if (
    args.creator.length !== 32 ||
    args.quoteMint.length !== 32 ||
    isZero32(args.creator) ||
    isZero32(args.quoteMint) ||
    !isU16(args.maxSnapshotAgeSlots) ||
    args.maxSnapshotAgeSlots === 0 ||
    !isU16(args.maxComponentSnapshotAgeSlots) ||
    args.maxComponentSnapshotAgeSlots === 0
  ) {
    throw new Error("InvalidCompositeFeedConfig");
  }
  assertPriceExponent(args.priceExponent, "InvalidCompositeFeedConfig");
  const quoteMint = new PublicKey(args.quoteMint);
  const cluster = args.cluster;
  if (cluster !== "mainnet" && cluster !== "localnet" && cluster !== "devnet") {
    throw new Error("MissingCompositeCluster");
  }
  if (!isMimirAdmittedQuoteMint(quoteMint, cluster)) {
    throw new Error("InvalidCompositeQuoteMint");
  }
  if (quoteMint.equals(MIMIR_SOL_MINT) && args.solConversionSourceConfig != null &&
      !isZero32(args.solConversionSourceConfig)) {
    throw new Error("InvalidCompositeQuoteMint");
  }
  if (
    !isU16(args.maxComponentConfidenceBps) ||
    args.maxComponentConfidenceBps > 10_000
  ) {
    throw new Error("InvalidCompositeConfidenceBps");
  }
  if (
    !isU16(args.maxComponentDispersionBps) ||
    args.maxComponentDispersionBps > 10_000
  ) {
    throw new Error("InvalidCompositeDispersionBps");
  }
  assertU64(args.registryEpoch, "InvalidRegistryEpoch");
  assertU64(args.configRevision, "InvalidConfigRevision");
  assertU64(args.adminConfigRevisionAtCreation, "InvalidAdminConfigRevision");
  assertU64(args.refreshFeeLamports, "InvalidRefreshFee");
  if (args.refreshFeeLamports === 0n) throw new Error("InvalidRefreshFee");
  if (args.registryEpoch === 0n) throw new Error("InvalidRegistryEpoch");
  if (args.configRevision === 0n) throw new Error("InvalidConfigRevision");
  if (args.adminConfigRevisionAtCreation === 0n) {
    throw new Error("InvalidAdminConfigRevision");
  }
  const components = canonicalCompositeComponents(args.components);
  if (
    args.solConversionSourceConfig != null &&
    args.solConversionSourceConfig.length !== 32
  ) {
    throw new Error("InvalidCompositeSolConversionSourceConfig");
  }

  const compositeFeedId = deriveCompositeFeedId(args, programId);
  const componentSetHash = computeCompositeComponentSetHash(args, programId);
  const solConversionSourceConfig =
    args.solConversionSourceConfig ?? Buffer.alloc(32);
  const [, bump] = findCompositeFeedConfigPda(compositeFeedId, programId);
  const out = Buffer.alloc(COMPOSITE_FEED_CONFIG_HEADER_LEN);
  COMPOSITE_FEED_CONFIG_MAGIC.copy(out, COMPOSITE_CONFIG_OFFSETS.magic);
  out.writeUInt16LE(0, COMPOSITE_CONFIG_OFFSETS.version);
  out.writeUInt16LE(
    COMPOSITE_FEED_CONFIG_HEADER_LEN,
    COMPOSITE_CONFIG_OFFSETS.headerLen,
  );
  Buffer.from(compositeFeedId).copy(out, COMPOSITE_CONFIG_OFFSETS.feedId);
  Buffer.from(args.creator).copy(out, COMPOSITE_CONFIG_OFFSETS.creator);
  Buffer.from(args.quoteMint).copy(out, COMPOSITE_CONFIG_OFFSETS.quoteMint);
  Buffer.from(solConversionSourceConfig).copy(
    out,
    COMPOSITE_CONFIG_OFFSETS.solConversionSourceConfig,
  );
  out.writeInt32LE(args.priceExponent, COMPOSITE_CONFIG_OFFSETS.priceExponent);
  out[COMPOSITE_CONFIG_OFFSETS.status] = 1;
  out[COMPOSITE_CONFIG_OFFSETS.routeabilityCap] = RouteabilityStatus.SafetyOnly;
  out[COMPOSITE_CONFIG_OFFSETS.riskTier] = RiskTier.Unrated;
  out[COMPOSITE_CONFIG_OFFSETS.componentCount] = components.length;
  out.writeUInt16LE(
    args.maxSnapshotAgeSlots,
    COMPOSITE_CONFIG_OFFSETS.maxSnapshotAgeSlots,
  );
  out.writeUInt16LE(
    args.maxComponentSnapshotAgeSlots,
    COMPOSITE_CONFIG_OFFSETS.maxComponentSnapshotAgeSlots,
  );
  out.writeUInt16LE(
    args.maxComponentConfidenceBps,
    COMPOSITE_CONFIG_OFFSETS.maxComponentConfidenceBps,
  );
  out.writeUInt16LE(
    args.maxComponentDispersionBps,
    COMPOSITE_CONFIG_OFFSETS.maxComponentDispersionBps,
  );
  componentSetHash.copy(out, COMPOSITE_CONFIG_OFFSETS.componentSetHash);
  out.writeBigUInt64LE(args.registryEpoch, COMPOSITE_CONFIG_OFFSETS.registryEpoch);
  out.writeBigUInt64LE(args.configRevision, COMPOSITE_CONFIG_OFFSETS.configRevision);
  out.writeBigUInt64LE(
    args.adminConfigRevisionAtCreation,
    COMPOSITE_CONFIG_OFFSETS.adminConfigRevisionAtCreation,
  );
  out[COMPOSITE_CONFIG_OFFSETS.bump] = bump;

  for (let index = 0; index < components.length; index += 1) {
    const component = components[index];
    const offset =
      COMPOSITE_CONFIG_OFFSETS.components + index * COMPOSITE_COMPONENT_CONFIG_LEN;
    Buffer.from(component.feedId).copy(
      out,
      offset + COMPOSITE_COMPONENT_OFFSETS.feedId,
    );
    Buffer.from(component.sourceConfig).copy(
      out,
      offset + COMPOSITE_COMPONENT_OFFSETS.feedConfig,
    );
    putU128(out, offset + COMPOSITE_COMPONENT_OFFSETS.quantityX64, component.quantityX64);
  }

  return out;
}

export function encodeUpsertRegistryData(registryHeader: Uint8Array): Buffer {
  if (registryHeader.length !== ORACLE_REGISTRY_HEADER_LEN) {
    throw new Error("InvalidRegistryHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([UPSERT_REGISTRY_TAG]),
    Buffer.from(registryHeader),
  ]);
}

export function computeRegistryGovernanceActionHash(
  currentRegistryHeader: Uint8Array,
  proposedRegistryHeader: Uint8Array,
): Buffer {
  if (
    currentRegistryHeader.length !== ORACLE_REGISTRY_HEADER_LEN ||
    proposedRegistryHeader.length !== ORACLE_REGISTRY_HEADER_LEN
  ) {
    throw new Error("InvalidRegistryHeaderLength");
  }
  return createHash("sha256")
    .update(Buffer.from("MIMIR_GOV_REGISTRY_V1", "ascii"))
    .update(Buffer.from(currentRegistryHeader))
    .update(Buffer.from(proposedRegistryHeader))
    .digest();
}

export function computeGovernancePolicyActionHash(
  currentPolicyHeader: Uint8Array,
  proposedPolicyHeader: Uint8Array,
): Buffer {
  if (
    currentPolicyHeader.length !== GOVERNANCE_POLICY_HEADER_LEN ||
    proposedPolicyHeader.length !== GOVERNANCE_POLICY_HEADER_LEN
  ) {
    throw new Error("InvalidGovernancePolicyHeaderLength");
  }
  return createHash("sha256")
    .update(Buffer.from("MIMIR_GOV_POLICY_V1", "ascii"))
    .update(Buffer.from(currentPolicyHeader))
    .update(Buffer.from(proposedPolicyHeader))
    .digest();
}

export function encodeUpsertGovernancePolicyData(policyHeader: Uint8Array): Buffer {
  if (policyHeader.length !== GOVERNANCE_POLICY_HEADER_LEN) {
    throw new Error("InvalidGovernancePolicyHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([UPSERT_GOVERNANCE_POLICY_TAG]),
    Buffer.from(policyHeader),
  ]);
}

export function upsertGovernancePolicyInstruction(args: {
  payer: PublicKey;
  authority: PublicKey;
  policy: PublicKey;
  policyHeader: Uint8Array;
  governanceAction?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  const keys = [
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: args.authority, isSigner: true, isWritable: false },
    { pubkey: args.policy, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  if (args.governanceAction) {
    keys.push({
      pubkey: args.governanceAction,
      isSigner: false,
      isWritable: false,
    });
  }
  return new TransactionInstruction({
    programId: args.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
    keys,
    data: encodeUpsertGovernancePolicyData(args.policyHeader),
  });
}

export function encodeCreateGovernanceActionData(actionHeader: Uint8Array): Buffer {
  if (actionHeader.length !== GOVERNANCE_ACTION_HEADER_LEN) {
    throw new Error("InvalidGovernanceActionHeaderLength");
  }
  return Buffer.concat([
    Buffer.from([CREATE_GOVERNANCE_ACTION_TAG]),
    Buffer.from(actionHeader),
  ]);
}

export function createGovernanceActionInstruction(args: {
  payer: PublicKey;
  proposer: PublicKey;
  policy: PublicKey;
  action: PublicKey;
  actionHeader: Uint8Array;
  programId?: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.payer, isSigner: true, isWritable: true },
      { pubkey: args.proposer, isSigner: true, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: false },
      { pubkey: args.action, isSigner: false, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: encodeCreateGovernanceActionData(args.actionHeader),
  });
}

export function encodeApproveGovernanceActionData(
  args: ApproveGovernanceActionArgs,
): Buffer {
  if (args.actionHash.length !== 32 || isZero32(args.actionHash)) {
    throw new Error("InvalidGovernanceActionHash");
  }
  if (args.expectedActionRevision <= 0n || args.expectedActionRevision > U64_MAX) {
    throw new Error("InvalidGovernanceActionRevision");
  }
  const out = Buffer.alloc(1 + APPROVE_GOVERNANCE_ACTION_LEN);
  let offset = 0;
  out[offset] = APPROVE_GOVERNANCE_ACTION_TAG;
  offset += 1;
  Buffer.from(args.actionHash).copy(out, offset);
  offset += 32;
  out.writeBigUInt64LE(args.expectedActionRevision, offset);
  return out;
}

export function approveGovernanceActionInstruction(args: {
  signer: PublicKey;
  policy: PublicKey;
  action: PublicKey;
  actionHash: Uint8Array;
  expectedActionRevision: bigint;
  programId?: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: args.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
    keys: [
      { pubkey: args.signer, isSigner: true, isWritable: false },
      { pubkey: args.policy, isSigner: false, isWritable: false },
      { pubkey: args.action, isSigner: false, isWritable: true },
    ],
    data: encodeApproveGovernanceActionData(args),
  });
}

export function upsertRegistryInstruction(args: {
  payer: PublicKey;
  authority: PublicKey;
  registry: PublicKey;
  registryHeader: Uint8Array;
  governancePolicy?: PublicKey;
  governanceAction?: PublicKey;
  programId?: PublicKey;
}): TransactionInstruction {
  if ((args.governancePolicy && !args.governanceAction) || (!args.governancePolicy && args.governanceAction)) {
    throw new Error("IncompleteGovernanceAction");
  }
  const keys = [
    { pubkey: args.payer, isSigner: true, isWritable: true },
    { pubkey: args.authority, isSigner: true, isWritable: false },
    { pubkey: args.registry, isSigner: false, isWritable: true },
    { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
  ];
  if (args.governancePolicy && args.governanceAction) {
    keys.push(
      { pubkey: args.governancePolicy, isSigner: false, isWritable: false },
      { pubkey: args.governanceAction, isSigner: false, isWritable: false },
    );
  }
  return new TransactionInstruction({
    programId: args.programId ?? CANONICAL_MIMIR_PROGRAM_ID,
    keys,
    data: encodeUpsertRegistryData(args.registryHeader),
  });
}
