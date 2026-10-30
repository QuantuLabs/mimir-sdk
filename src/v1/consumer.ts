import type { Address } from "@solana/kit";
import * as C from "./layout/common.js";
import * as X from "./layout/composite.js";
import bs58 from "bs58";
import { betaError } from "../beta/errors.js";
import { v1CompositePrefixLen, V1_COMPOSITE_MAGIC, V1_SNAPSHOT_MAGIC, type V1NoticeKind } from "./decoders.js";
import { fromBase64 } from "../beta/bytes.js";
import type { MimirBetaFinalizedRpc } from "../beta/rpc.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";
/** generation, close_after_slot, notice_kind: `[P, P + 17)` for both kinds. */
const OWNER_HEAD_LEN = C.OWNER_NOTICE_KIND + 1;
/** Largest consumer read: composite `P + 17` at count 5 (covers the Classic `[0, 529)`). */
export const V1_CONSUMER_READ_LEN = v1CompositePrefixLen(X.COMPOSITE_MAX_COMPONENTS) + OWNER_HEAD_LEN;

/** 0 none; 1 DISCRETIONARY → wind down; 2 ABANDONED → keep (rescue is possible until close). */
export type V1NoticePolicy = "none" | "wind-down" | "keep";

export function v1NoticePolicy(kind: V1NoticeKind): V1NoticePolicy {
  return kind === C.NOTICE_DISCRETIONARY ? "wind-down" : kind === C.NOTICE_ABANDONED ? "keep" : "none";
}

export interface V1ConsumerPin {
  readonly programId: Address;
  readonly address: Address;
  readonly generation: bigint;
}

export interface V1ConsumerAccount {
  readonly owner: Address;
  /** At least `[0, P + 17)`; a `V1_CONSUMER_READ_LEN` slice is enough. */
  readonly data: Uint8Array;
}

export interface V1ConsumerView {
  readonly kind: "classic" | "composite";
  /** Bytes consumers hash: `data[0, prefixLen)`. */
  readonly prefixLen: number;
  readonly generation: bigint;
  readonly closeAfterSlot: bigint;
  readonly noticeKind: V1NoticeKind;
  readonly notice: V1NoticePolicy;
}

/**
 * Checks a consumer pin `(address, generation)` against an account read. Fails closed on a missing, System-owned,
 * foreign-owned or malformed account and on a generation mismatch (closed and recreated at the same address).
 */
export function checkV1ConsumerPin(pin: V1ConsumerPin, account: V1ConsumerAccount | null): V1ConsumerView {
  if (account === null) betaError("ACCOUNT_NOT_FOUND", `${pin.address} does not exist`);
  if (account.owner === SYSTEM_PROGRAM) betaError("ACCOUNT_SYSTEM_OWNED", `${pin.address} is System-owned (closed)`);
  if (account.owner !== pin.programId) betaError("ACCOUNT_OWNER_MISMATCH", `${pin.address} is not owned by ${pin.programId}`);
  const data = account.data;
  const magic = (m: Uint8Array) => data.length >= 8 && m.every((b, i) => data[i] === b);
  let kind: "classic" | "composite";
  let prefixLen: number;
  if (magic(V1_SNAPSHOT_MAGIC)) {
    kind = "classic"; prefixLen = C.CLASSIC_PREFIX_LEN;
  } else if (magic(V1_COMPOSITE_MAGIC) && data.length > X.CSP_COUNT) {
    const count = data[X.CSP_COUNT]!;
    if (count < 1 || count > 5) betaError("ACCOUNT_MALFORMED", `composite count ${count}`);
    kind = "composite"; prefixLen = v1CompositePrefixLen(count);
  } else {
    return betaError("ACCOUNT_MALFORMED", `${pin.address} is not a V1 feed`);
  }
  if (data.length < prefixLen + OWNER_HEAD_LEN) betaError("ACCOUNT_MALFORMED", `${pin.address} read is shorter than ${prefixLen + OWNER_HEAD_LEN} B`);
  if (bs58.encode(data.subarray(C.PREFIX_SELF_ADDRESS, C.PREFIX_SELF_ADDRESS + 32)) !== pin.address) {
    betaError("ACCOUNT_MALFORMED", "prefix @48 is not this account");
  }
  const view = new DataView(data.buffer, data.byteOffset + prefixLen, OWNER_HEAD_LEN);
  const generation = view.getBigUint64(C.OWNER_GENERATION, true);
  const noticeKind = data[prefixLen + C.OWNER_NOTICE_KIND]!;
  if (noticeKind > C.NOTICE_ABANDONED) betaError("ACCOUNT_MALFORMED", `notice_kind ${noticeKind}`);
  if (generation !== pin.generation) betaError("GENERATION_MISMATCH", `${pin.address} generation ${generation} != pinned ${pin.generation}`);
  return {
    kind, prefixLen, generation, closeAfterSlot: view.getBigUint64(C.OWNER_CLOSE_AFTER_SLOT, true),
    noticeKind: noticeKind as V1NoticeKind, notice: v1NoticePolicy(noticeKind as V1NoticeKind),
  };
}

/** One `getAccountInfo` of `[0, V1_CONSUMER_READ_LEN)`, then `checkV1ConsumerPin`. */
export async function readV1ConsumerPin(rpc: Pick<MimirBetaFinalizedRpc, "getAccountInfo">, pin: V1ConsumerPin,
  commitment: "confirmed" | "finalized" = "confirmed"): Promise<V1ConsumerView> {
  const response = await rpc.getAccountInfo(pin.address, {
    commitment, encoding: "base64", dataSlice: { offset: 0, length: V1_CONSUMER_READ_LEN },
  }).send() as { value?: { owner?: unknown; data?: unknown } | null } | null;
  const value = response?.value;
  if (value === null || value === undefined) return checkV1ConsumerPin(pin, null);
  if (typeof value.owner !== "string" || !Array.isArray(value.data) || typeof value.data[0] !== "string") {
    betaError("RPC_CONTEXT_MISMATCH", "getAccountInfo returned a malformed account");
  }
  return checkV1ConsumerPin(pin, { owner: value.owner as Address, data: fromBase64(value.data[0] as string) });
}
