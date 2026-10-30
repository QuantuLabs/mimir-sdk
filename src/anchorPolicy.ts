import { createHash } from "./internal/sha256.js";
import { freshNumberRecord } from "./internal/canonicalAuthority.js";

const AnchorProvider = freshNumberRecord("AnchorProvider");

const U64_MAX = (1n << 64n) - 1n;

export const TIER_A_ANCHOR_POLICY_HASH_DOMAIN = "MIMIR_ANCHOR_POLICY_V1";

export interface TierAAnchorPolicy {
  feedId: Uint8Array;
  anchorProvider: number;
  providerProgramId: Uint8Array;
  providerFeedHash: Uint8Array;
  verificationLevel: number;
  minPublisherCount: number;
  maxConfidenceBps: number;
  maxPublishAgeSlots: bigint | number;
  maxDivergenceBps: number;
  nativeExceptionHash?: Uint8Array | null;
}

export interface EvaluateTierAAnchorPolicyArgs {
  policy: TierAAnchorPolicy;
  expectedFeedId?: Uint8Array;
  expectedNativeExceptionHash?: Uint8Array | null;
  allowNativeOnlyException?: boolean;
}

export type TierAAnchorPolicyFailureCode =
  | "FeedMismatch"
  | "AnchorProviderInvalid"
  | "NativeExceptionNotAllowed"
  | "NativeExceptionMismatch";

export interface TierAAnchorPolicyFailure {
  code: TierAAnchorPolicyFailureCode;
  actual?: bigint | number | string;
  required?: bigint | number | string;
}

export interface TierAAnchorPolicyEvaluation {
  eligible: boolean;
  failures: TierAAnchorPolicyFailure[];
  anchorPolicyHash: Buffer;
}

function normalizeAnchorPolicyValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAnchorPolicyValue(entry));
  }
  if (value != null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalizeAnchorPolicyValue(source[key]);
    }
    return out;
  }
  return value;
}

export function stringifyAnchorPolicyReport(report: unknown): string {
  return `${JSON.stringify(normalizeAnchorPolicyValue(report), null, 2)}\n`;
}

function assertBytes32(value: Uint8Array, label: string): void {
  if (value.length !== 32) throw new Error(label);
}

function bytes32(value: Uint8Array, label: string): Buffer {
  assertBytes32(value, label);
  return Buffer.from(value);
}

function isZeroBytes(value: Uint8Array): boolean {
  for (const byte of value) {
    if (byte !== 0) return false;
  }
  return true;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function assertU64(value: bigint): void {
  if (value < 0n || value > U64_MAX) {
    throw new Error("InvalidAnchorPolicy");
  }
}

function assertU8(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 255) {
    throw new Error("InvalidAnchorPolicy");
  }
}

function assertBps(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 10_000) {
    throw new Error("InvalidAnchorPolicy");
  }
}

function assertU16(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 65_535) {
    throw new Error("InvalidAnchorPolicy");
  }
}

function slotDeltaToBigint(value: bigint | number): bigint {
  if (typeof value === "bigint") {
    assertU64(value);
    return value;
  }
  if (
    !Number.isInteger(value) ||
    value < 0 ||
    !Number.isSafeInteger(value)
  ) {
    throw new Error("InvalidAnchorPolicy");
  }
  return BigInt(value);
}

function u8(value: number): Buffer {
  assertU8(value);
  return Buffer.from([value]);
}

function u16le(value: number): Buffer {
  assertU16(value);
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

function bps16le(value: number): Buffer {
  assertBps(value);
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value, 0);
  return out;
}

function u64le(value: bigint): Buffer {
  assertU64(value);
  const out = Buffer.alloc(8);
  out.writeBigUInt64LE(value, 0);
  return out;
}

export function computeTierAAnchorPolicyHash(
  policy: TierAAnchorPolicy,
): Buffer {
  const maxPublishAgeSlots = slotDeltaToBigint(policy.maxPublishAgeSlots);
  const nativeExceptionHash = policy.nativeExceptionHash ?? Buffer.alloc(32);
  const hasher = createHash("sha256");
  hasher.update(Buffer.from(TIER_A_ANCHOR_POLICY_HASH_DOMAIN, "ascii"));
  hasher.update(bytes32(policy.feedId, "Expected32Bytes"));
  hasher.update(u8(policy.anchorProvider));
  hasher.update(bytes32(policy.providerProgramId, "Expected32Bytes"));
  hasher.update(bytes32(policy.providerFeedHash, "Expected32Bytes"));
  hasher.update(u8(policy.verificationLevel));
  hasher.update(u16le(policy.minPublisherCount));
  hasher.update(bps16le(policy.maxConfidenceBps));
  hasher.update(u64le(maxPublishAgeSlots));
  hasher.update(bps16le(policy.maxDivergenceBps));
  hasher.update(bytes32(nativeExceptionHash, "Expected32Bytes"));
  return hasher.digest();
}

export function evaluateTierAAnchorPolicy(
  args: EvaluateTierAAnchorPolicyArgs,
): TierAAnchorPolicyEvaluation {
  const policy = args.policy;
  const anchorPolicyHash = computeTierAAnchorPolicyHash(policy);
  const failures: TierAAnchorPolicyFailure[] = [];
  if (
    args.expectedFeedId != null &&
    !bytesEqual(policy.feedId, args.expectedFeedId)
  ) {
    assertBytes32(args.expectedFeedId, "Expected32Bytes");
    failures.push({ code: "FeedMismatch" });
  }
  if (policy.anchorProvider === AnchorProvider.NativeOnlyException) {
    if (args.allowNativeOnlyException !== true) {
      failures.push({ code: "NativeExceptionNotAllowed" });
    }
    const nativeExceptionHash = policy.nativeExceptionHash;
    if (
      nativeExceptionHash == null ||
      args.expectedNativeExceptionHash == null ||
      isZeroBytes(nativeExceptionHash) ||
      !bytesEqual(nativeExceptionHash, args.expectedNativeExceptionHash)
    ) {
      if (nativeExceptionHash != null) {
        assertBytes32(nativeExceptionHash, "Expected32Bytes");
      }
      if (args.expectedNativeExceptionHash != null) {
        assertBytes32(args.expectedNativeExceptionHash, "Expected32Bytes");
      }
      failures.push({ code: "NativeExceptionMismatch" });
    }
  } else {
    failures.push({
      code: "AnchorProviderInvalid",
      actual: policy.anchorProvider,
      required: "NativeOnlyException",
    });
  }
  return {
    eligible: failures.length === 0,
    failures,
    anchorPolicyHash,
  };
}
