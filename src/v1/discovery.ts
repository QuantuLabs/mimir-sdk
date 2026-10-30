import type { Address } from "@solana/kit";
import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import * as X from "./layout/composite.js";
import { decodeV1OwnerRecord, v1CompositePrefixLen, V1_CLASSIC_MAGIC, V1_COMPOSITE_MAGIC, V1_SNAPSHOT_MAGIC, type V1OwnerRecord } from "./decoders.js";
import { betaError } from "../beta/errors.js";
import { base64, fromBase64 } from "../beta/bytes.js";
import type { MimirBetaProgramAccountsRpc } from "../beta/pairFeeds.js";

export interface V1FeedListing {
  readonly kind: "classic" | "composite";
  readonly address: Address;
  /** Owner record decoded from the listing read itself: notice and identity need no second read. */
  readonly owner: V1OwnerRecord;
}

const memcmp = (offset: number, bytes: Uint8Array) => ({ memcmp: { offset: BigInt(offset), bytes: base64(bytes), encoding: "base64" } });

async function programAccounts(rpc: MimirBetaProgramAccountsRpc, programId: Address, filters: readonly object[],
  dataSlice: { offset: number; length: number }): Promise<{ address: Address; data: Uint8Array }[]> {
  const rows = await rpc.getProgramAccounts(programId, { commitment: "confirmed", encoding: "base64", dataSlice, filters }).send();
  const list = Array.isArray(rows) ? rows : (rows as { value?: unknown } | null)?.value;
  if (!Array.isArray(list)) betaError("RPC_CONTEXT_MISMATCH", "getProgramAccounts returned no list");
  return list.map((row: { pubkey?: unknown; account?: { data?: unknown } }) => {
    const data = row.account?.data;
    if (typeof row.pubkey !== "string" || !Array.isArray(data) || typeof data[0] !== "string") betaError("RPC_CONTEXT_MISMATCH", "getProgramAccounts row malformed");
    return { address: row.pubkey as Address, data: fromBase64(data[0] as string) };
  });
}

/** Every V1 Classic feed: one gPA filtered on the `MIMIRSNP` and `MIMIRCLX` magics, sliced to the 81-B owner record. */
export async function listV1ClassicFeeds(rpc: MimirBetaProgramAccountsRpc, programId: Address): Promise<V1FeedListing[]> {
  const rows = await programAccounts(rpc, programId, [memcmp(K.OFFSET_MAGIC, V1_SNAPSHOT_MAGIC), memcmp(K.CLASSIC_HEADER + K.H_MAGIC, V1_CLASSIC_MAGIC)],
    { offset: K.CLASSIC_OWNER, length: C.OWNER_CLASSIC_LEN });
  return rows.map(({ address, data }) => ({ kind: "classic" as const, address, owner: decodeV1OwnerRecord(data, "classic") }));
}

/** Composite listing slice: `count @109` through the owner record at the largest count. */
const COMPOSITE_SLICE = {
  offset: X.CSP_COUNT,
  length: v1CompositePrefixLen(X.COMPOSITE_MAX_COMPONENTS) + C.OWNER_COMPOSITE_LEN - X.CSP_COUNT,
};

/**
 * Every V1 composite: one gPA filtered on the `MIMIRCSP` magic. The owner record sits at `P = 320 + 80·count`, so the
 * slice runs from `count @109` to the owner record end at count 5 (660 B) to keep a single program scan.
 */
export async function listV1Composites(rpc: MimirBetaProgramAccountsRpc, programId: Address): Promise<V1FeedListing[]> {
  const rows = await programAccounts(rpc, programId, [memcmp(X.CSP_MAGIC_AT, V1_COMPOSITE_MAGIC)], COMPOSITE_SLICE);
  return rows.map(({ address, data }) => {
    const count = data[0]!;
    if (count < X.COMPOSITE_MIN_COMPONENTS || count > X.COMPOSITE_MAX_COMPONENTS) betaError("ACCOUNT_MALFORMED", `${address} composite count ${count}`);
    const at = v1CompositePrefixLen(count) - X.CSP_COUNT;
    return { kind: "composite" as const, address, owner: decodeV1OwnerRecord(data.subarray(at, at + C.OWNER_COMPOSITE_LEN), "composite") };
  });
}
