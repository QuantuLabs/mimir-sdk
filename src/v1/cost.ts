import * as C from "./layout/common.js";
import * as K from "./layout/classic.js";
import * as X from "./layout/composite.js";
import { v1MembershipLen, v1TemporalModuleLen } from "./decoders.js";
import { computeMimirRentExemptLamports, readMimirRentSysvar, type MimirRentSysvar } from "../beta/rent.js";
import type { MimirBetaFinalizedRpc } from "../beta/rpc.js";

/** The bytes a row adds beyond its fixed slot: its membership record and its temporal module. */
export interface V1RowShape {
  /** Descriptor binding version bit1 (M0): 4-B membership. */
  readonly derived: boolean;
  readonly bindingWidth: number;
  readonly temporalKind: number;
}

const tail = (rows: readonly V1RowShape[]) =>
  rows.reduce((sum, row) => sum + v1MembershipLen(row.derived, row.bindingWidth) + v1TemporalModuleLen(row.temporalKind), 0);
const converterLen = (converters: readonly V1RowShape[]) =>
  converters.length === 0 ? 0 : C.CONVERTER_FIXED_LEN + C.SOURCE_ROW_LEN * converters.length;

function checkCounts(primaries: number, max: number, converters: number) {
  if (!Number.isInteger(primaries) || primaries < 1 || primaries > max || converters > K.CLASSIC_MAX_CONVERTER_ROWS) {
    throw new RangeError(`row counts ${primaries}/${converters} out of range`);
  }
}

/** Exact V1 Classic account length (LAYOUT_V1_CLASSIC §1): reference CPMM M0 2,506 B, SOL-quoted 5,251 B. */
export function v1ClassicAccountLen(shape: { readonly primaries: readonly V1RowShape[]; readonly converters?: readonly V1RowShape[] }): number {
  const converters = shape.converters ?? [];
  checkCounts(shape.primaries.length, K.CLASSIC_MAX_PRIMARY_ROWS, converters.length);
  return K.CLASSIC_ROWS + C.SOURCE_ROW_LEN * shape.primaries.length + converterLen(converters) + tail([...shape.primaries, ...converters]);
}

/** Exact V1 composite account length (LAYOUT_V1_COMPOSITE §2): N=2 compact M0 3,288 B, N=5 7,215 B. */
export function v1CompositeAccountLen(shape: { readonly components: readonly V1RowShape[]; readonly converters?: readonly V1RowShape[] }): number {
  const converters = shape.converters ?? [];
  const n = shape.components.length;
  checkCounts(n, X.COMPOSITE_MAX_COMPONENTS, converters.length);
  const full = shape.components.some((row) => row.temporalKind === C.TEMPORAL_MTP4_SAMPLED || row.temporalKind === C.TEMPORAL_MTP4_POINT);
  const dual = shape.components.some((row) => row.temporalKind === C.TEMPORAL_DUAL_NATIVE_POINT_V1);
  return X.ROWS_AT_FIXED + X.ROWS_AT_PER_COMPONENT * n + (full ? X.ROW_FULL_LEN : X.ROW_COMPACT_LEN) * n + converterLen(converters)
    + tail([...shape.components, ...converters])
    + (dual ? X.DUAL_PROOF_HEADER_LEN + X.DUAL_PROOF_ROW_LEN * n + (converters.length === 0 ? 0 : X.DUAL_PROOF_CONVERTER_LEN) : 0);
}

export interface V1CreationRent {
  readonly account: bigint;
  readonly tickerClaim: bigint;
  /** `account + tickerClaim`; transaction fees, the one-time generation counter and the identity claim are not included. */
  readonly total: bigint;
}

/** Rent a creation locks: the feed or composite account plus its 43-B ticker claim. */
export function v1CreationRentLamports(rent: MimirRentSysvar, accountLen: number): V1CreationRent {
  const account = computeMimirRentExemptLamports(rent, accountLen);
  const tickerClaim = computeMimirRentExemptLamports(rent, C.TICKER_CLAIM_ACCOUNT_LEN);
  return { account, tickerClaim, total: account + tickerClaim };
}

/** Reads the live rent sysvar once per reader and caches it; a failed read is not cached. */
export function createV1RentReader(rpc: Pick<MimirBetaFinalizedRpc, "getAccountInfo">) {
  let cached: Promise<MimirRentSysvar> | null = null;
  const rent = () => (cached ??= readMimirRentSysvar(rpc).catch((error) => { cached = null; throw error; }));
  return {
    rent,
    rentExemptLamports: async (dataLen: number) => computeMimirRentExemptLamports(await rent(), dataLen),
    creationRentLamports: async (accountLen: number) => v1CreationRentLamports(await rent(), accountLen),
  };
}

/** CU hint: 40k plus 150k per row, at least 1.15x every main9g fuzz/bank maximum (worst by rows: 1 = 161,879 CPMM near-max history,
 * 2 = 175,794, 3 = 217,239, 4 = 307,970, 5 = 248,803, 6 = 302,730). */
export function mimirV1RefreshComputeUnitLimit(rows: number): number {
  return Math.min(1_400_000, 40_000 + 150_000 * rows);
}
