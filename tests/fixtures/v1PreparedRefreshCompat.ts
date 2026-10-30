import { prepareMimirV1ClassicRefresh, prepareMimirV1CompositeRefresh, type MimirV1PreparedRefresh } from "../../src/v1/index.js";

export const legacyPreparedRefresh = (p: MimirV1PreparedRefresh): MimirV1PreparedRefresh =>
  ({ instruction: p.instruction, computeUnitLimit: 1, contextSlot: 1n, mode: "publish" });
export const classicReader =
  (p: Awaited<ReturnType<typeof prepareMimirV1ClassicRefresh>>) => p.unavailableRows.length;
export const compositeReader =
  (p: Awaited<ReturnType<typeof prepareMimirV1CompositeRefresh>>) => p.unavailableRows.length;
