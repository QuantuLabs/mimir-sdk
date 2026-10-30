import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";
import { decodeMimirBetaCaptureCandidate, deriveMimirBetaCaptureReadPlan, mimirBetaCaptureScanDescriptors } from "../src/beta/capture.js";

type Row = { owner: Address; executable: boolean; data: string };
const fixture = JSON.parse(readFileSync(new URL("./fixtures/c03-r37-clock-race.json", import.meta.url), "utf8")) as {
  pool: Address; baseMint: Address; quoteMint: Address; discovery: Record<string, Row>; fresh: Record<string, Row> };
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
const account = (address: string, row: Row) => ({ address: address as Address, owner: row.owner, executable: row.executable,
  data: Uint8Array.from(Buffer.from(row.data, "base64")) });
const context = (row: Row) => { const data = Buffer.from(row.data, "base64");
  return { observedSlot: data.readBigUInt64LE(0), observedUnixTimestamp: data.readBigInt64LE(32) }; };
const descriptor = mimirBetaCaptureScanDescriptors().find((entry) => entry.family === "raydium-clmm")!;
const pair = { baseMint: fixture.baseMint, quoteMint: fixture.quoteMint };
const discoveryContext = context(fixture.discovery[CLOCK]!); const freshContext = context(fixture.fresh[CLOCK]!);
assert.deepEqual(discoveryContext, { observedSlot: 452299180n, observedUnixTimestamp: 1790878527n });
assert.deepEqual(freshContext, { observedSlot: 452299181n, observedUnixTimestamp: 1790878528n });
const plan = (primary: Row, at: typeof freshContext) =>
  deriveMimirBetaCaptureReadPlan({ descriptor, primary: account(fixture.pool, primary), pair, context: at });
const discoveryPlan = plan(fixture.discovery[fixture.pool]!, discoveryContext);
const freshPlan = plan(fixture.fresh[fixture.pool]!, freshContext);
assert.deepEqual(freshPlan.allAddresses, discoveryPlan.allAddresses);
assert.deepEqual(freshPlan.auxiliary.map(({ address, role, index }) => [address, role, index]),
  discoveryPlan.auxiliary.map(({ address, role, index }) => [address, role, index]));
const accounts = freshPlan.allAddresses.map((entry) => account(entry, fixture.fresh[entry]!));
await assert.rejects(decodeMimirBetaCaptureCandidate({ descriptor, pair, context: discoveryContext, expectedPlan: discoveryPlan, accounts }),
  /InvalidRaydiumClmmObservationState/);
assert.equal((await decodeMimirBetaCaptureCandidate({ descriptor, pair, context: freshContext, expectedPlan: freshPlan, accounts })).pool, fixture.pool);
const futureContext = { observedSlot: freshContext.observedSlot, observedUnixTimestamp: discoveryContext.observedUnixTimestamp };
const futurePlan = plan(fixture.fresh[fixture.pool]!, futureContext);
await assert.rejects(decodeMimirBetaCaptureCandidate({ descriptor, pair, context: futureContext, expectedPlan: futurePlan, accounts }),
  /InvalidRaydiumClmmObservationState/);
console.log("clockRebind tests passed");
