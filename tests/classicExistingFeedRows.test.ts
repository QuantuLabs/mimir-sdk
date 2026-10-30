import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { buildMimirExistingFeedFusedRows } from "../src/existingFeedRows.js";
import { buildMimirFusedClassicInstruction, decodeMimirClassicExecutionAccount, mimirFusedClassicRequest } from "../src/beta/classicExecution.js";
import { decodeMimirBetaLiveFeed } from "../src/beta/liveAbi.js";

// Captured devnet JUP/RAY/ORCA/SKR classic feeds (sealed native-bounded CPMM E5), replayed offline.
const { program, targets, recorded } = JSON.parse(readFileSync(new URL("./fixtures/classicExistingFeedFourFeeds.json", import.meta.url), "utf8"));
const initial = recorded[0].response.result;
const connection = new Connection("http://127.0.0.1:1", "finalized");
const CLOCK = "SysvarC1ock11111111111111111111111111111111";
let next = 1, calls = 0, serial = 0, skew = 0, ahead = false, skipped = 0, elided = 0, forge: ((value: { owner: string; executable: boolean }[]) => void) | undefined;
(connection as unknown as { _rpcRequest: unknown })._rpcRequest = async (method: string, params: unknown) => {
  calls++;
  const [clock, program, pool] = recorded.slice(next, next + 3);
  if (method === "getMultipleAccounts" && clock?.params[0] === CLOCK && program?.method === "getAccountInfo" && pool?.method === "getAccountInfo") {
    serial += 3;
    const [keys, config] = params as [string[], { minContextSlot?: number }];
    assert.deepEqual(keys, [program.params[0], pool.params[0], CLOCK], "one batched program/pool/Clock cohort");
    const value = structuredClone([program.response.result.value, pool.response.result.value, clock.response.result.value]);
    forge?.(value);
    let slot = clock.response.result.context.slot;
    if (config.minContextSlot !== undefined) slot = Math.max(slot, config.minContextSlot);
    if (ahead) {
      const clockData = Buffer.from((value[2] as { data: [string, string] }).data[0], "base64");
      clockData.writeBigUInt64LE(BigInt(slot) + 1n);
      (value[2] as { data: [string, string] }).data[0] = clockData.toString("base64");
    } else if (skew > 0) { skew--; slot -= 1; } else next += 3;
    return { ...clock.response, result: { context: { ...clock.response.result.context, slot }, value } };
  }
  serial++;
  const primaryOnly = recorded[next], capture = recorded[next + 1];
  const [requestedKeys, requestedConfig] = params as [unknown, { minContextSlot?: number }];
  const skip = primaryOnly?.method === "getMultipleAccounts" && primaryOnly.params[0].length === 2 && primaryOnly.params[0][1] === CLOCK &&
    capture?.method === method && JSON.stringify(capture.params[0]) === JSON.stringify(requestedKeys) &&
    (requestedConfig.minContextSlot ?? 0) <= capture.params[1].minContextSlot;
  if (skip) { next++; serial++; skipped++; }
  const live = recorded[next + 3];
  const elide = !skip && recorded[next]?.method === "getAccountInfo" && recorded[next].params[0] === CLOCK && live?.method === method &&
    JSON.stringify(live.params[0]) === JSON.stringify(requestedKeys) && (requestedConfig.minContextSlot ?? 0) <= live.params[1].minContextSlot;
  if (elide) { next += 3; serial += 3; elided++; }
  const c = structuredClone(recorded[next++]);
  if (skip || elide || elided && c.method === method && JSON.stringify(c.params[0]) === JSON.stringify(requestedKeys) &&
      (requestedConfig.minContextSlot ?? 0) <= (c.params[1]?.minContextSlot ?? 0)) c.params[1].minContextSlot = requestedConfig.minContextSlot;
  if (c.method === "getAccountInfo" && c.params[0] === "SysvarC1ock11111111111111111111111111111111") {
    c.method = "getMultipleAccounts"; c.params[0] = [c.params[0]]; c.response.result.value = [c.response.result.value];
  }
  assert.equal(method, c.method); assert.equal(JSON.stringify(params), JSON.stringify(c.params)); return c.response;
};
const profile = { cluster: "devnet", name: "custom", programId: new PublicKey(program) } as never;
const registry = PublicKey.findProgramAddressSync([Buffer.from("mimir_registry"), Buffer.from([0, 0])], new PublicKey(program))[0].toBase58();
const shape = (r: { recipe: { mode: number; externalWidth: number } }) => [r.recipe.mode, r.recipe.externalWidth];

for (const pass of ["sealed", "component", "inferred"] as const) {
  next = 1;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i], acct = initial.value[6 * i];
    const state = await decodeMimirClassicExecutionAccount({ programId: program, address: t.execution, owner: acct.owner, data: Buffer.from(acct.data[0], "base64"), requireActive: true });
    const feedId = Buffer.from(t.feedIdHex, "hex");
    if (pass === "component") {
      const rows = await buildMimirExistingFeedFusedRows({ connection, profile, feedId, role: "component", commitment: "finalized" });
      assert.deepEqual(rows.map(shape), [[6, 4]], `${t.symbol} CPMM component stays spot E4`);
      continue;
    }
    if (pass === "inferred") {
      const rows = await buildMimirExistingFeedFusedRows({ connection, profile, feedId, role: "primary", commitment: "finalized" });
      assert.deepEqual(rows.map(shape), [[3, 7]], `${t.symbol} no descriptors: initializer inference unchanged`);
      continue;
    }
    const rows = await buildMimirExistingFeedFusedRows({ connection, profile, feedId, role: "primary", commitment: "finalized", descriptors: state.primary.map((r) => r.descriptor) });
    assert.deepEqual(rows.map(shape), [[2, 5]], `${t.symbol} rows follow the sealed native E5 descriptor`);
    assert.equal(rows[0]!.recipe.temporalKind, 0);
    const snapshot = Buffer.from(initial.value[6 * i + 5].data[0], "base64");
    const ix = buildMimirFusedClassicInstruction({ programId: program, snapshot: t.snapshot, registry: registry as never, execution: t.execution, layout: state.layout,
      primaryExternals: rows.map((r) => r.externals), converterExternals: [], request: mimirFusedClassicRequest({ state, snapshotRevision: snapshot.readBigUInt64LE(96),
        mode: "publish", declaredMaxSnapshotAge: decodeMimirBetaLiveFeed(state.feedConfigImage).maxSnapshotAgeSlots }) });
    assert.equal(ix.data[0], 89); assert.equal(ix.accounts.length, 8, `${t.symbol} tag 89 = snapshot + registry + execution + 5 externals`);
  }
  if (pass !== "inferred") assert.equal(next, recorded.length);
}

// One batched cohort per discovery replaces the serial Clock, program and pool round trips.
next = 1; calls = 0; serial = 0; skipped = 0; elided = 0;
await buildMimirExistingFeedFusedRows({ connection, profile, feedId: Buffer.from(targets[0].feedIdHex, "hex"), role: "component", commitment: "finalized" });
console.log(`classicExistingFeedRows: round trips ${serial} serial -> ${calls} batched`);
assert.equal(serial - calls, 5, "batched program/pool/Clock cohort and the same-action capture floor elides the Clock/primary/capture revalidation wave");
assert.deepEqual([elided, skipped], [1, 0], "the live load reuses the discovery capture floor and keeps its coherent protocol read");

// A skewed cohort Clock retries the whole cohort; an RPC that honours the floor but keeps its Clock a slot ahead fails closed as not converged.
next = 1; skew = 1;
await buildMimirExistingFeedFusedRows({ connection, profile, feedId: Buffer.from(targets[0].feedIdHex, "hex"), role: "component", commitment: "finalized" });
next = 1; ahead = true;
await assert.rejects(buildMimirExistingFeedFusedRows({ connection, profile, feedId: Buffer.from(targets[0].feedIdHex, "hex"), role: "component", commitment: "finalized" }),
  (e: Error) => (e as { code?: string }).code === "RPC_CONTEXT_MISMATCH" && e.message === "RPC_CONTEXT_MISMATCH:chunked read contexts did not converge");
ahead = false;

// Forged program executable or pool owner in the batched cohort are still rejected.
for (const mutate of [(v: { executable: boolean }[]) => { v[0]!.executable = false; }, (v: { owner: string }[]) => { v[1]!.owner = CLOCK; }]) {
  next = 1; forge = mutate as never;
  await assert.rejects(buildMimirExistingFeedFusedRows({ connection, profile, feedId: Buffer.from(targets[0].feedIdHex, "hex"), role: "component", commitment: "finalized" }), (e) => !(e instanceof assert.AssertionError));
}
forge = undefined;
console.log("classicExistingFeedRows: OK");
