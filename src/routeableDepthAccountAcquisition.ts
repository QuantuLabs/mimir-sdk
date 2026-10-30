import { createHash } from "./internal/sha256.js";
import { PublicKey, type Commitment } from "@solana/web3.js";

export const ROUTEABLE_DEPTH_ACCOUNT_DATA_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_ACCOUNT_DATA_V1";
export const ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_V1";
export const ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_SET_HASH_DOMAIN =
  "MIMIR_ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_SET_V1";

export interface RouteableDepthFetchedAccountInfo {
  data: Uint8Array;
  owner: PublicKey | Uint8Array;
  executable?: boolean;
}

export interface RouteableDepthAccountConnection {
  getMultipleAccountsInfo(
    publicKeys: PublicKey[],
    commitment?: Commitment,
  ): Promise<(RouteableDepthFetchedAccountInfo | null)[]>;
}

export interface RouteableDepthAccountRequest {
  role: string;
  publicKey: PublicKey;
  expectedOwnerProgramId?: PublicKey | Uint8Array | null;
  minDataLength?: number;
  maxDataLength?: number;
  allowExecutable?: boolean;
}

export interface RouteableDepthAccountRecord {
  role: string;
  publicKey: string;
  ownerProgramId: string;
  executable: boolean;
  dataLength: number;
  dataHash: string;
}

export interface RouteableDepthAccountBundle {
  fixtureId: string;
  commitment: Commitment | null;
  accountCount: number;
  records: RouteableDepthAccountRecord[];
  bundleHash: string;
}

export interface FetchRouteableDepthAccountBundleArgs {
  connection: RouteableDepthAccountConnection;
  fixtureId: string;
  requests: readonly RouteableDepthAccountRequest[];
  commitment?: Commitment;
}

function normalizeAccountAcquisitionValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString("hex");
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeAccountAcquisitionValue(entry));
  }
  if (value != null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = normalizeAccountAcquisitionValue(source[key]);
    }
    return out;
  }
  return value;
}

function assertNonEmptyAscii(value: string): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 128 ||
    !/^[\x20-\x7e]+$/.test(value)
  ) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
}

function assertDataLength(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000_000) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
}

function publicKeyBytes(value: PublicKey | Uint8Array): Buffer {
  const bytes = value instanceof PublicKey ? value.toBytes() : Buffer.from(value);
  if (bytes.length !== 32) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
  return Buffer.from(bytes);
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

function assertHex64(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
}

export function computeRouteableDepthAccountDataHash(
  accountData: Uint8Array,
): string {
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_ACCOUNT_DATA_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(accountData);
  return hasher.digest("hex");
}

export function computeRouteableDepthAccountBundleHash(
  bundle: Omit<RouteableDepthAccountBundle, "bundleHash">,
): string {
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(
    JSON.stringify(normalizeAccountAcquisitionValue(bundle)),
    "utf8",
  );
  return hasher.digest("hex");
}

export function computeRouteableDepthAccountBundleSetHash(
  entries: readonly { fixtureId: string; bundleHash: string }[],
): string {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
  const seen = new Set<string>();
  for (const entry of entries) {
    assertNonEmptyAscii(entry.fixtureId);
    if (seen.has(entry.fixtureId)) {
      throw new Error("InvalidRouteableDepthAccountAcquisition");
    }
    seen.add(entry.fixtureId);
    assertHex64(entry.bundleHash);
  }
  const canonicalEntries = [...entries].sort((a, b) => {
    const fixtureDelta = a.fixtureId.localeCompare(b.fixtureId);
    if (fixtureDelta !== 0) return fixtureDelta;
    return a.bundleHash.localeCompare(b.bundleHash);
  });
  const hasher = createHash("sha256");
  hasher.update(ROUTEABLE_DEPTH_ACCOUNT_BUNDLE_SET_HASH_DOMAIN, "ascii");
  hasher.update(Buffer.from([0]));
  hasher.update(
    JSON.stringify(normalizeAccountAcquisitionValue(canonicalEntries)),
    "utf8",
  );
  return hasher.digest("hex");
}

function validateRequest(request: RouteableDepthAccountRequest): void {
  assertNonEmptyAscii(request.role);
  if (!(request.publicKey instanceof PublicKey)) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
  if (request.minDataLength != null) assertDataLength(request.minDataLength);
  if (request.maxDataLength != null) assertDataLength(request.maxDataLength);
  if (
    request.minDataLength != null &&
    request.maxDataLength != null &&
    request.minDataLength > request.maxDataLength
  ) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
  if (typeof (request.allowExecutable ?? false) !== "boolean") {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
}

export async function fetchRouteableDepthAccountBundle(
  args: FetchRouteableDepthAccountBundleArgs,
): Promise<RouteableDepthAccountBundle> {
  assertNonEmptyAscii(args.fixtureId);
  if (
    !Array.isArray(args.requests) ||
    args.requests.length === 0 ||
    args.requests.length > 64
  ) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }
  const seenRoles = new Set<string>();
  const seenKeys = new Set<string>();
  for (const request of args.requests) {
    validateRequest(request);
    if (seenRoles.has(request.role)) {
      throw new Error("InvalidRouteableDepthAccountAcquisition");
    }
    seenRoles.add(request.role);
    const key = request.publicKey.toBase58();
    if (seenKeys.has(key)) {
      throw new Error("InvalidRouteableDepthAccountAcquisition");
    }
    seenKeys.add(key);
  }

  const accounts = await args.connection.getMultipleAccountsInfo(
    args.requests.map((request) => request.publicKey),
    args.commitment,
  );
  if (!Array.isArray(accounts) || accounts.length !== args.requests.length) {
    throw new Error("InvalidRouteableDepthAccountAcquisition");
  }

  const records: RouteableDepthAccountRecord[] = accounts.map(
    (account, index) => {
      if (account == null) {
        throw new Error("MissingRouteableDepthAccount");
      }
      const request = args.requests[index];
      const executable = account.executable === true;
      if (executable && request.allowExecutable !== true) {
        throw new Error("ExecutableRouteableDepthAccount");
      }
      const ownerProgramId = publicKeyBytes(account.owner);
      if (
        request.expectedOwnerProgramId != null &&
        !bytesEqual(
          ownerProgramId,
          publicKeyBytes(request.expectedOwnerProgramId),
        )
      ) {
        throw new Error("RouteableDepthAccountOwnerMismatch");
      }
      const dataLength = account.data.length;
      assertDataLength(dataLength);
      if (
        (request.minDataLength != null &&
          dataLength < request.minDataLength) ||
        (request.maxDataLength != null && dataLength > request.maxDataLength)
      ) {
        throw new Error("RouteableDepthAccountDataLengthMismatch");
      }
      return {
        role: request.role,
        publicKey: request.publicKey.toBase58(),
        ownerProgramId: ownerProgramId.toString("hex"),
        executable,
        dataLength,
        dataHash: computeRouteableDepthAccountDataHash(account.data),
      };
    },
  );

  const bundleWithoutHash = {
    fixtureId: args.fixtureId,
    commitment: args.commitment ?? null,
    accountCount: records.length,
    records,
  };
  return {
    ...bundleWithoutHash,
    bundleHash: computeRouteableDepthAccountBundleHash(bundleWithoutHash),
  };
}
