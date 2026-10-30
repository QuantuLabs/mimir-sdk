import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { Address } from "@solana/kit";
import { buildMimirFusedCompositeRefreshInstruction, buildMimirInitFusedCompositeClosure, deriveMimirFusedRecipe, mimirCompositeExecutionLayout,
  mimirFusedRecipeNeedsWarmup } from "../src/beta/compositeExecution.js";
import { compileMimirBetaTransactionV1 } from "../src/beta/transactionV1.js";
import { mimirBetaPacketRefusal } from "../src/beta/creation.js";
import { MimirBetaPacketRefusalError } from "../src/beta/errors.js";
import { bytesAddress } from "../src/beta/bytes.js";

// N3S4 [Oq,D1rn,D1rn]|[D0rn x4]: BEGIN/GROW/SEAL fits, the mandatory standalone tag 87 needs 65 keys and is refused as composite:publish.
const bytes = (s: string) => new Uint8Array(createHash("sha256").update(s).digest());
const key = (s: string) => bytesAddress(bytes(`role:${s}`)) as Address;
const shape = (converterCount: number) => {
  const components = [[0, 0, 9], [3, 1, 10], [3, 1, 10]].map(([adapterType, adapterVersion, externalWidth]) =>
    deriveMimirFusedRecipe({ role: "component", adapterType: adapterType!, adapterVersion: adapterVersion!, externalWidth: externalWidth!, minSlotGap: 1, accountsBindingVersion: 1 }));
  const converters = Array.from({ length: converterCount }, () =>
    deriveMimirFusedRecipe({ role: "converter", adapterType: 3, adapterVersion: 0, externalWidth: 9, minSlotGap: 1, accountsBindingVersion: 1 }));
  const layout = mimirCompositeExecutionLayout(components, converters); const pins = [key("dlmm-program"), key("dlmm-programdata")];
  const componentExternals = components.map((_, i) => i === 0 ? Array.from({ length: 9 }, (_, j) => key(`orca-${j}`))
    : [...Array.from({ length: 8 }, (_, j) => key(`component-${i}-${j}`)), ...pins]);
  const converterExternals = converters.map((_, i) => [...Array.from({ length: 7 }, (_, j) => key(`converter-${i}-${j}`)), ...pins]);
  const witnesses = layout.descriptors.map((r, i) => ({ feedId: bytes(i < 3 ? `component-feed-${i}` : "converter-feed"), sourceIndex: i < 3 ? 0 : i - 3,
    ringVersion: 1, minSlotGap: r.minSlotGap, expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n, expectedPlanHash: bytes(i < 3 ? `plan-${i}` : "converter-plan"),
    sourceSetSiblings: [0, 1, 2].map((j) => bytes(`source-proof-${i}-${j}`)), accountsSiblings: [0, 1, 2].map((j) => bytes(`account-proof-${i}-${j}`)) }));
  const common = { programId: key("mimir-program"), payer: key("payer"), execution: key("execution"), collateralLock: key("lock"),
    compositeConfig: key("cfc"), registry: key("registry"), compositeFeedId: bytes("composite-feed"), layout };
  const init = buildMimirInitFusedCompositeClosure({ ...common, witnesses, components: componentExternals.map((externals, i) => ({
    sourceConfig: key(`source-config-${i}`), feedConfig: key(`feed-config-${i}`), sourcingPlan: key(`plan-${i}`), externals })),
    converter: { feedConfig: key("converter-feed"), sourcingPlan: key("converter-plan"),
      sources: converterExternals.map((externals, i) => ({ sourceConfig: key(`converter-source-${i}`), externals })) } });
  const publish = buildMimirFusedCompositeRefreshInstruction({ ...common, compositeSnapshot: key("csp"), adminConfig: key("admin"), feeVault: key("fee-vault"),
    treasury: key("treasury"), componentExternals, converterExternals, request: { compositeFeedId: common.compositeFeedId, expectedConfigRevision: 1n,
      previousSnapshotRevision: 0n, nextSnapshotRevision: 1n, componentSourceConfigRevisions: [1n, 1n, 1n], maxRefreshFeeLamports: 1n,
      componentRingNewestSlots: [0n, 0n, 0n], converterRingNewestSlots: converters.map(() => 0n) } });
  const roles = Object.fromEntries([...componentExternals.map((e, i) => [`component${i}`, e] as const), ...converterExternals.map((e, j) => [`converter${j}`, e] as const)]);
  return { warmup: [...components, ...converters].some(mimirFusedRecipeNeedsWarmup), payer: common.payer, init, publish, roles, executionLength: layout.exactLength };
};
const compile = (payer: Address, instructions: Parameters<typeof compileMimirBetaTransactionV1>[0]["instructions"]) =>
  compileMimirBetaTransactionV1({ feePayer: payer, recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions });

const n3s4 = shape(4);
assert.equal(n3s4.warmup, true, "Orca quiet makes the recipe set warm, so no publication is staged at creation");
const init = await compile(n3s4.payer, n3s4.init);
assert.deepEqual([init.packet.accountCount, init.packet.serializedTransactionBytes, init.packet.instructionCount, n3s4.executionLength], [47, 3914, 3, 12184]);
const error = await compile(n3s4.payer, [n3s4.publish]).then(() => null, (e: Error) => e);
assert.ok(error && (error as Error & { code?: string }).code === "TRANSACTION_TOO_LARGE" && /64 accounts/.test(error.message), String(error));
const refusal = await mimirBetaPacketRefusal("composite:publish", n3s4.payer, [n3s4.publish], n3s4.roles, error);
assert.ok(refusal instanceof MimirBetaPacketRefusalError);
assert.equal(refusal.stage, "composite:publish");
assert.match(refusal.message, /composite:publish does not fit one Transaction v1 \(65 keys.*so it cannot be created$/);

const n3s1 = shape(1);
assert.equal(n3s1.warmup, true);
assert.ok((await compile(n3s1.payer, [n3s1.publish])).packet.accountCount <= 64, "a fitting warming publication keeps its path");
console.log("composite publish fit ok");
