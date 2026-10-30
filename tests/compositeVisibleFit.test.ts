import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Address } from "@solana/kit";
import { buildMimirFusedCompositeRefreshInstruction, deriveMimirFusedRecipe, mimirCompositeExecutionLayout } from "../src/beta/compositeExecution.js";
import { compileMimirBetaTransactionV1 } from "../src/beta/transactionV1.js";
import { admitMimirTxV1Packet } from "../src/beta/abi1Release.js";
import { mimirDlmmVisibleFitOrder } from "../src/beta/creation.js";
import { bytesAddress } from "../src/beta/bytes.js";
import type { MimirBetaEligiblePool } from "../src/beta/discovery.js";

// Tag-87 producer keys: DLMM routeable (3 arrays) vs native visible (1 array); G/PD pins shared by every DLMM row.
const key = (s: string) => bytesAddress(new Uint8Array(createHash("sha256").update(`role:${s}`).digest())) as Address;
type Row = readonly [adapterType: number, version: number, width: number, dlmm?: boolean, point?: boolean];
const Oq: Row = [0, 0, 9], M: Row = [7, 0, 3], C1n: Row = [1, 1, 9], Pc: Row = [2, 0, 4], P1: Row = [6, 1, 9, false, true];
const D1rn: Row = [3, 1, 10, true], D1v: Row = [3, 1, 8, true], D0rn: Row = [3, 0, 9, true], D0v: Row = [3, 0, 7, true];
const keys = async (components: readonly Row[], converters: readonly Row[]) => {
  const recipe = (role: "component" | "converter") => ([adapterType, adapterVersion, externalWidth, , point]: Row) => deriveMimirFusedRecipe({ role, adapterType,
    adapterVersion, externalWidth, minSlotGap: point ? 0 : 1, accountsBindingVersion: 1, ...(point ? { temporalModuleVersion: 4, currentPoint: true } : {}) });
  const layout = mimirCompositeExecutionLayout(components.map(recipe("component")), converters.map(recipe("converter")));
  const externals = (tag: string) => ([, , width, dlmm]: Row, i: number) => dlmm
    ? [...Array.from({ length: width - 2 }, (_, j) => key(`${tag}-${i}-${j}`)), key("dlmm-program"), key("dlmm-programdata")]
    : Array.from({ length: width }, (_, j) => key(`${tag}-${i}-${j}`));
  const publish = buildMimirFusedCompositeRefreshInstruction({ programId: key("mimir"), payer: key("payer"), compositeSnapshot: key("csp"), compositeConfig: key("cfc"),
    registry: key("registry"), adminConfig: key("admin"), feeVault: key("fee-vault"), treasury: key("treasury"), execution: key("execution"), layout,
    componentExternals: components.map(externals("component")), converterExternals: converters.map(externals("converter")),
    request: { compositeFeedId: new Uint8Array(32).fill(7), expectedConfigRevision: 1n, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n,
      componentSourceConfigRevisions: components.map(() => 1n), maxRefreshFeeLamports: 1n, componentRingNewestSlots: components.map(() => 0n),
      converterRingNewestSlots: converters.map(() => 0n) } });
  const { keys } = await admitMimirTxV1Packet({ payer: key("payer"), instructions: [publish], cu: null });
  const fits = await compileMimirBetaTransactionV1({ feePayer: key("payer"), recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n,
    instructions: [publish] }).then((tx) => (assert.equal(tx.packet.accountCount, keys), true), (e: Error & { code?: string }) => (assert.equal(e.code, "TRANSACTION_TOO_LARGE"), false));
  assert.equal(fits, keys <= 64);
  return keys;
};
const n = (row: Row, count: number) => Array.from({ length: count }, () => row);
// Counterexample N3S4: existing D0rn x4 converter keeps its sealed binding; inline components switch -> 61 fits (53 if every leg were new).
assert.deepEqual(await Promise.all([keys([Oq, D1rn, D1rn], n(D0rn, 4)), keys([Oq, D1v, D1rn], n(D0rn, 4)), keys([Oq, D1v, D1v], n(D0rn, 4)),
  keys([Oq, D1v, D1v], n(D0v, 4))]), [65, 63, 61, 53]);
// Rich MIX5 / D0rn x3: one switchable DLMM leg -> 65, still refused pre-payment; fits only with a native-visible converter (59).
assert.deepEqual(await Promise.all([keys([M, C1n, D1rn, Pc, P1], n(D0rn, 3)), keys([M, C1n, D1v, Pc, P1], n(D0rn, 3)),
  keys([M, C1n, D1v, Pc, P1], n(D0v, 3))]), [67, 65, 59]);
// D5 / D0 x4: 80 -> 70 (still refused) with the existing routeable converter; 62 when the converter legs are native visible too.
assert.deepEqual(await Promise.all([keys(n(D1rn, 5), n(D0rn, 4)), keys(n(D1v, 5), n(D0rn, 4)), keys(n(D1v, 5), n(D0v, 4))]), [80, 70, 62]);

const pool = (name: string, routeable: boolean, liquidity: bigint, depth = 1n, adapterType = 3) =>
  ({ pool: key(name), minLiquidityNative: liquidity, minDepthTo50BpsNative: depth,
    creation: { adapterType, bindingVariant: routeable ? "routeable" : "direct" } }) as unknown as MimirBetaEligiblePool;
const order = mimirDlmmVisibleFitOrder([{ componentIndex: 0, converter: false, pool: pool("a", true, 5n) },
  { componentIndex: 1, converter: false, pool: pool("b", true, 9n) }, { componentIndex: 2, converter: true, pool: pool("c", true, 1n) },
  { componentIndex: 3, converter: false, pool: pool("d", false, 99n) }, { componentIndex: 4, converter: false, pool: pool("e", true, 99n, 0n) },
  { componentIndex: 5, converter: false, pool: pool("f", true, 99n, 1n, 1) }]);
assert.deepEqual(order.map((leg) => [leg.componentIndex, leg.converter, leg.minDepthTo50BpsNative]), [[2, true, 1n], [1, false, 1n], [0, false, 1n]],
  "converter first, then larger pool; direct, zero-depth and non-DLMM legs never switch");
console.log("composite visible fit ok");
