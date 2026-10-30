import { createHash } from "./internal/sha256.js";
import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  CONFIG_OFFSETS,
  FEED_CONFIG_V1_HEADER_LEN,
  FEED_SNAPSHOT_MIN_HEADER_LEN,
} from "./constants.js";
import { decodeLifecycleFeedConfigHeader, decodeFeedSnapshotHeader } from "./codec.js";
import { decodeMimirBetaTicker } from "./beta/abi.js";
import type { FeedSnapshotHeader } from "./types.js";
import {
  freshCanonicalAuthority,
  freshPublicKey,
} from "./internal/canonicalAuthority.js";

const PRIVATE_AUTHORITY = freshCanonicalAuthority(PublicKey);
const { SourceDirection } =
  PRIVATE_AUTHORITY;

function freshInstruction(
  opts: ConstructorParameters<typeof TransactionInstruction>[0],
): TransactionInstruction {
  return new TransactionInstruction({
    keys: opts.keys.map((meta) => ({
      pubkey: new PublicKey(meta.pubkey.toBytes()),
      isSigner: meta.isSigner,
      isWritable: meta.isWritable,
    })),
    programId: new PublicKey(opts.programId.toBytes()),
    data: opts.data ? Buffer.from(opts.data) : undefined,
  });
}

function canonicalMimirCollateralProgramId(): PublicKey {
  return freshPublicKey("MIMIR", PublicKey);
}

function assertOrdinaryFeedId(feedId: Uint8Array): void {
  if (feedId.length !== 32) throw new Error("Expected32Bytes");
  if (feedId.some((byte) => byte !== 0)) return;
  throw new Error("InvalidFeedId");
}

function deriveMimirFeedConfigPda(feedId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  assertOrdinaryFeedId(feedId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("feed_config"), Buffer.from(feedId)],
    programId,
  );
}

function deriveMimirFeedSnapshotPda(feedId: Uint8Array, programId: PublicKey): [PublicKey, number] {
  assertOrdinaryFeedId(feedId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("feed_snapshot"), Buffer.from(feedId)],
    programId,
  );
}

const U64_MAX = (1n << 64n) - 1n;
const ACCOUNT_FACT_BRAND: unique symbol = Symbol("MimirAuthenticatedAccountFactV1");
const authenticatedAccountFacts = new WeakSet<object>();
const accountFactAuthorities = new WeakMap<object, object>();
const configProgramAuthorities = new WeakMap<object, PublicKey>();

interface AuthenticatedAccountFactBrand {
  readonly [ACCOUNT_FACT_BRAND]: true;
}

function authenticatedAccountFact<T extends object>(fact: T): T & AuthenticatedAccountFactBrand {
  const authority = cloneFactAuthority(fact);
  Object.defineProperty(fact, ACCOUNT_FACT_BRAND, { value: true });
  authenticatedAccountFacts.add(fact);
  accountFactAuthorities.set(fact, authority);
  Object.freeze(fact);
  return fact as T & AuthenticatedAccountFactBrand;
}

function cloneFactAuthority<T>(value: T): T {
  if (Buffer.isBuffer(value)) return Buffer.from(value) as T;
  if (value instanceof PublicKey) return new PublicKey(value.toBytes()) as T;
  if (value instanceof TransactionInstruction) {
    return freshInstruction({
      programId: new PublicKey(value.programId.toBytes()),
      keys: value.keys.map((meta) => ({
        pubkey: new PublicKey(meta.pubkey.toBytes()),
        isSigner: meta.isSigner,
        isWritable: meta.isWritable,
      })),
      data: Buffer.from(value.data),
    }) as T;
  }
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneFactAuthority) as T;
  const out: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(value)) out[key] = cloneFactAuthority(field);
  return out as T;
}

function requireAuthenticatedAccountFact<T extends object>(fact: T, name: string): T {
  if (!authenticatedAccountFacts.has(fact)) fail(`Unauthenticated${name}`);
  return accountFactAuthorities.get(fact) as T;
}

function captureOwnDataRecord(
  value: unknown,
  keys: readonly string[] | null,
  name: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(name);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail(name);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some((key) => typeof key === "symbol")) fail(name);
  const actual = ownKeys as string[];
  if (keys !== null) {
    const expected = [...keys].sort();
    const sorted = [...actual].sort();
    if (sorted.length !== expected.length || sorted.some((key, index) => key !== expected[index])) {
      fail(name);
    }
  }
  const capture: Record<string, unknown> = {};
  for (const key of actual) {
    const descriptor = descriptors[key];
    if (!descriptor || !("value" in descriptor)) fail(name);
    capture[key] = descriptor.value;
  }
  return capture;
}

function capturePublicKey(value: unknown, name: string): PublicKey {
  if (value === null || typeof value !== "object") fail(name);
  let toBytes: unknown;
  try {
    toBytes = Reflect.get(value, "toBytes", value);
  } catch {
    fail(name);
  }
  if (typeof toBytes !== "function") fail(name);
  try {
    const captured = Reflect.apply(toBytes, value, []);
    if (!(captured instanceof Uint8Array) || captured.byteLength !== 32) fail(name);
    const bytes = new Uint8Array(captured);
    return new PublicKey(bytes);
  } catch {
    fail(name);
  }
}

function captureBytes(value: unknown, name: string): Buffer {
  if (!(value instanceof Uint8Array)) fail(name);
  return Buffer.from(value);
}

export interface MimirAccountShell {
  address: PublicKey;
  owner: PublicKey;
  executable: boolean;
  data: Uint8Array;
}

function fail(name: string): never {
  throw new Error(name);
}

function assertZero(data: Buffer, start: number, end: number, name: string): void {
  for (let offset = start; offset < end; offset += 1) {
    if (data[offset] !== 0) fail(name);
  }
}

function captureShell(shell: MimirAccountShell, length: number | readonly [number, number], name: string, programId: PublicKey): MimirAccountShell & { data: Buffer } {
  const malformed = `Malformed${name}Shell`;
  const source = captureOwnDataRecord(shell, ["address", "owner", "executable", "data"], malformed);
  const capture = {
    address: capturePublicKey(source.address, malformed),
    owner: capturePublicKey(source.owner, malformed),
    executable: source.executable as boolean,
    data: captureBytes(source.data, malformed),
  };
  const validLength = typeof length === "number"
    ? capture.data.byteLength === length
    : length.includes(capture.data.byteLength);
  if (
    !capture.owner.equals(programId) ||
    capture.executable !== false ||
    !validLength
  ) {
    fail(`Invalid${name}Shell`);
  }
  return capture;
}

function assertReservedZero(
  data: Buffer,
  ranges: readonly (readonly [number, number])[],
  name: string,
): void {
  for (const [start, end] of ranges) assertZero(data, start, end, name);
}

function same32(left: Uint8Array, right: Uint8Array): boolean {
  return Buffer.from(left).equals(Buffer.from(right));
}

export interface AuthenticatedMimirFeedConfigV1 extends AuthenticatedAccountFactBrand {
  kind: "FeedConfig";
  key: PublicKey;
  data: Buffer;
  feedId: Buffer;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  priceExponent: number;
  orientation: typeof SourceDirection.QuotePerBase;
  riskTier: number;
  lifecycleState: number;
  baseDecimals: number;
  quoteDecimals: number;
  revision: bigint;
  registryEpoch: bigint;
  bump: number;
}

export interface AuthenticatedMimirFeedSnapshotV1 extends AuthenticatedAccountFactBrand {
  kind: "FeedSnapshot";
  key: PublicKey;
  configKey: PublicKey;
  feedId: Buffer;
  configRevision: bigint;
  revision: bigint;
  status: number;
  riskTier: number;
  slot: bigint;
  validUntilSlot: bigint;
  publishTime: bigint;
  priceExponent: number;
  priceX64: bigint;
  priceLowerX64: bigint;
  priceUpperX64: bigint;
  confidenceBps: number;
  dispersionBps: number;
  coverageRatioBps: number;
  sourceCount: number;
  venueCount: number;
  correlationGroupCount: number;
  quoteStatus: number;
  bandCapitalNotional: bigint;
  attackerSetFeeLossFloorMirror: bigint;
  attackerSetEconLossFloorNative: bigint;
  attackerSetCapitalRequiredFloorNative: bigint;
  config: AuthenticatedMimirFeedConfigV1;
}

export function verifyMimirFeedConfigV1(
  shell: MimirAccountShell,
  programId: PublicKey = canonicalMimirCollateralProgramId(),
): AuthenticatedMimirFeedConfigV1 {
  const program = capturePublicKey(programId, "InvalidMimirFeedConfigV1ProgramId");
  const capturedShell = captureShell(shell, FEED_CONFIG_V1_HEADER_LEN, "MimirFeedConfigV1", program);
  const data = capturedShell.data;
  const decoded = decodeLifecycleFeedConfigHeader(data);
  const version = data.readUInt16LE(CONFIG_OFFSETS.version);
  const reservedError = "InvalidMimirFeedConfigV1Reserved";
  assertReservedZero(data, [[123, 124], [134, 136]], reservedError);
  if (version === 1) {
    const flags = data.readUInt32LE(CONFIG_OFFSETS.flags);
    if (flags === 0) assertReservedZero(data, [[313, 325]], reservedError);
    else if (flags === 1) decodeMimirBetaTicker(data.subarray(313, 325));
    else fail(reservedError);
  } else {
    fail("InvalidMimirFeedConfigV1Version");
  }
  const [address, bump] = deriveMimirFeedConfigPda(decoded.feedId, program);
  if (!capturedShell.address.equals(address) || decoded.bump !== bump) fail("InvalidMimirFeedConfigV1Pda");
  const fact: AuthenticatedMimirFeedConfigV1 = authenticatedAccountFact({
    kind: "FeedConfig",
    key: capturedShell.address,
    data,
    feedId: Buffer.from(decoded.feedId),
    baseMint: new PublicKey(decoded.baseMint),
    quoteMint: new PublicKey(decoded.quoteMint),
    priceExponent: decoded.priceExponent,
    orientation: SourceDirection.QuotePerBase,
    riskTier: decoded.riskTier,
    lifecycleState: decoded.lifecycleState,
    baseDecimals: decoded.baseDecimals,
    quoteDecimals: decoded.quoteDecimals,
    revision: decoded.feedConfigRevision,
    registryEpoch: decoded.registryEpoch,
    bump: decoded.bump,
  });
  configProgramAuthorities.set(accountFactAuthorities.get(fact)!, program);
  return fact;
}

export function verifyMimirFeedSnapshotV1(
  shell: MimirAccountShell,
  config: AuthenticatedMimirFeedConfigV1,
): AuthenticatedMimirFeedSnapshotV1 {
  const authenticatedConfig = requireAuthenticatedAccountFact(config, "MimirFeedConfigV1Fact");
  const program = configProgramAuthorities.get(authenticatedConfig)!;
  const capturedShell = captureShell(shell, FEED_SNAPSHOT_MIN_HEADER_LEN, "MimirFeedSnapshotV1", program);
  const data = capturedShell.data;
  assertReservedZero(data, [[12, 16], [110, 116], [336, 352], [504, 512]], "InvalidMimirFeedSnapshotV1Reserved");
  const decoded: FeedSnapshotHeader = decodeFeedSnapshotHeader(data);
  const [address] = deriveMimirFeedSnapshotPda(decoded.feedId, program);
  if (
    !capturedShell.address.equals(address) ||
    !same32(decoded.feedId, authenticatedConfig.feedId) ||
    !new PublicKey(decoded.feedConfig).equals(authenticatedConfig.key) ||
    decoded.feedConfigRevision !== authenticatedConfig.revision ||
    decoded.registryEpoch !== authenticatedConfig.registryEpoch
  ) {
    fail("InvalidMimirFeedSnapshotV1Binding");
  }
  return authenticatedAccountFact({
    kind: "FeedSnapshot",
    key: capturedShell.address,
    configKey: authenticatedConfig.key,
    feedId: Buffer.from(decoded.feedId),
    configRevision: decoded.feedConfigRevision,
    revision: decoded.snapshotRevision,
    status: decoded.status,
    riskTier: decoded.riskTier,
    slot: decoded.snapshotSlot,
    validUntilSlot: decoded.validUntilSlot,
    publishTime: decoded.snapshotUnixTs,
    priceExponent: decoded.priceExponent,
    priceX64: decoded.priceX64,
    priceLowerX64: decoded.priceLowerX64,
    priceUpperX64: decoded.priceUpperX64,
    confidenceBps: decoded.confidenceBps,
    dispersionBps: decoded.dispersionBps,
    coverageRatioBps: decoded.coverageRatioBps,
    sourceCount: decoded.sourceCount,
    venueCount: decoded.venueCount,
    correlationGroupCount: decoded.correlationGroupCount,
    quoteStatus: decoded.quoteStatus,
    bandCapitalNotional: decoded.bandCapitalNotional,
    attackerSetFeeLossFloorMirror: decoded.attackerSetFeeLossFloorMirror,
    attackerSetEconLossFloorNative: decoded.attackerSetEconLossFloorNative,
    attackerSetCapitalRequiredFloorNative: decoded.attackerSetCapitalRequiredFloorNative,
    config,
  });
}

export function computeMimirFeedPolicyCommitmentV1(
  registry: PublicKey,
  config: AuthenticatedMimirFeedConfigV1,
): Buffer {
  const authenticatedConfig = requireAuthenticatedAccountFact(config, "MimirFeedConfigV1Fact");
  return computeAuthenticatedFeedPolicyCommitmentV1(registry, authenticatedConfig);
}

function computeAuthenticatedFeedPolicyCommitmentV1(
  registry: PublicKey,
  authenticatedConfig: AuthenticatedMimirFeedConfigV1,
): Buffer {
  if (!(registry instanceof PublicKey) ||
    authenticatedConfig.data.length !== FEED_CONFIG_V1_HEADER_LEN) {
    fail("InvalidMimirFeedPolicyCommitmentV1Input");
  }
  return createHash("sha256")
    .update("MIMIR_FEED_POLICY_COMMITMENT_V1", "ascii")
    .update(Buffer.from([0]))
    .update(configProgramAuthorities.get(authenticatedConfig)!.toBuffer())
    .update(registry.toBuffer())
    .update(authenticatedConfig.key.toBuffer())
    .update(authenticatedConfig.data)
    .digest();
}

export function normalizeMimirCollateralPriceX64(
  pointX64: bigint,
  exponent: number,
): bigint {
  if (pointX64 === 0n || !Number.isInteger(exponent) || exponent < -18 || exponent > 18) {
    fail("InvalidMimirCollateralNormalizedPrice");
  }
  const scale = 10n ** BigInt(Math.abs(exponent));
  const value = exponent < 0
    ? (pointX64 * scale) >> 64n
    : exponent > 0
      ? pointX64 / ((1n << 64n) * scale)
      : pointX64 >> 64n;
  if (value > U64_MAX) fail("InvalidMimirCollateralNormalizedPrice");
  return value;
}
