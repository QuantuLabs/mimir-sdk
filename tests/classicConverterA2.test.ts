import assert from "node:assert/strict";
import type { Address } from "@solana/kit";
import { assertMimirAbi1Capable, mimirRecipeTupleKey, type MimirAbi1Capability, type MimirBankCellV1 } from "../src/beta/abi1Release.js";
import { buildMimirFusedClassicInstruction, buildMimirInitFusedClassicClosure, deriveMimirClassicRecipe, decodeMimirFusedClassicData, mimirClassicExecutionLayout,
  mimirClassicRow } from "../src/beta/classicExecution.js";
import { mimirFusedRecipeBindingVariant } from "../src/beta/compositeExecution.js";
import { mimirClassicSampleOnlyRows } from "../src/beta/creation.js";
import { bytesAddress } from "../src/beta/bytes.js";
import { classicRowExternals } from "../src/beta/live.js";

const key = (n: number) => bytesAddress(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n & 255 : i === 1 ? n >> 8 : 9)));
const PROGRAM = key(1); const PAYER = key(2); const EXECUTION = key(3); const SNAPSHOT = key(4); const FEED = key(5); const PLAN = key(6);
const REGISTRY = key(7); const CONV_FEED = key(8); const CONV_PLAN = key(9);
const SYSTEM = "11111111111111111111111111111111" as Address; const IXS = "Sysvar1nstructions1111111111111111111111111" as Address;
const feedId = new Uint8Array(32).fill(11); const convFeedId = new Uint8Array(32).fill(12);
const witness = (id: Uint8Array, sourceIndex: number) => ({ feedId: id, sourceIndex, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n,
  expectedSourceSetRevision: 1n, expectedPlanHash: new Uint8Array(32).fill(3), sourceSetSiblings: [0, 1, 2].map(() => new Uint8Array(32)),
  accountsSiblings: [0, 1, 2].map(() => new Uint8Array(32)) });
const row = (role: "primary" | "converter", i: number) => mimirClassicRow({ role, adapterType: 2, adapterVersion: 0, currentPoint: false,
  sourceConfig: key(role === "primary" ? 100 + i : 200 + i), feedConfig: role === "primary" ? FEED : CONV_FEED, sourcingPlan: role === "primary" ? PLAN : CONV_PLAN,
  adapterAccounts: Array.from({ length: role === "primary" ? 4 : 5 }, (_, j) => key((role === "primary" ? 1000 : 2000) + i * 10 + j)),
  witness: witness(role === "primary" ? feedId : convFeedId, i) });

for (const s of [1, 5]) {
  const primary = [row("primary", 0)]; const converter = Array.from({ length: s }, (_, j) => row("converter", j));
  const w = 1 + s;
  const layout = mimirClassicExecutionLayout(primary.map((r) => r.recipe), converter.map((r) => r.recipe));
  assert.equal(layout.exactLength, 2_781 + 1_829 + 1_208 * s, `N1 CPMM + S${s} K4 converter rows (§2.5: one adds 3,037)`);
  assert.deepEqual(converter.map((r) => r.recipe.mode), converter.map(() => 2));
  const closure = buildMimirInitFusedClassicClosure({ programId: PROGRAM, payer: PAYER, execution: EXECUTION, collateralLock: key(990), snapshot: SNAPSHOT, feedConfig: FEED,
    sourcingPlan: PLAN, registry: REGISTRY, feedId, layout, witnesses: [...primary, ...converter].map((r) => r.witness), primary,
    converter: { feedConfig: CONV_FEED, sourcingPlan: CONV_PLAN, sources: converter } });
  const [begin, ...rest] = closure; const seal = rest.pop()!;
  assert.deepEqual([begin!.data[0], begin!.data[1], begin!.data.length, begin!.data[34], begin!.data[35]], [90, 0, 40, 1, s]);
  assert.equal(rest.length, layout.growCount); for (const g of rest) assert.deepEqual([g.data[0], g.data[1], g.data.length], [90, 1, 38]);
  assert.deepEqual([seal.data[0], seal.data[1], seal.data.length, seal.data[34], seal.data[35]], [90, 2, 36 + 301 * w, 1, s]);
  // classic_init.rs seal: payer, execution, snapshot, feed, plan, registry, system, primary (SC + E), converter feed/plan, converter (SC + E), sysvar last.
  assert.deepEqual(seal.accounts.map((m) => m.address), [PAYER, EXECUTION, SNAPSHOT, FEED, PLAN, REGISTRY, SYSTEM,
    ...primary.flatMap((r) => [r.sourceConfig, ...r.externals]), CONV_FEED, CONV_PLAN, ...converter.flatMap((r) => [r.sourceConfig, ...r.externals]), IXS]);
  assert.equal(seal.accounts.length, 8 + 5 + 2 + 6 * s);
  assert.deepEqual(seal.accounts.slice(0, 2).map((m) => [m.isSigner, m.isWritable]), [[true, true], [false, true]]);
  assert.ok(seal.accounts.slice(2).every((m) => !m.isSigner && !m.isWritable));
  // Sample-only keeps new=previous; publish is previous+1. Ring heads are primary then converter.
  for (const [mode, next] of [["sample", 3n], ["publish", 4n]] as const) {
    const request = { feedId, declaredMaxSnapshotAge: 30, previousSnapshotRevision: 3n, nextSnapshotRevision: next, componentCount: 1, sourceSetRevision: 1n,
      planHash: new Uint8Array(32).fill(3), converterSourceCount: s, feedConfigRevision: 1n, ringNewestSlots: Array.from({ length: w }, (_, r) => BigInt(50 + r)) };
    const ix = buildMimirFusedClassicInstruction({ programId: PROGRAM, snapshot: SNAPSHOT, registry: REGISTRY, execution: EXECUTION, layout,
      primaryExternals: primary.map((r) => r.externals), converterExternals: converter.map((r) => r.externals), request });
    assert.deepEqual([ix.data[0], ix.data.length, ix.data[51], ix.data[92]], [89, 104 + 8 * w, 1, s], mode);
    assert.deepEqual(decodeMimirFusedClassicData(ix.data), request, `${mode} round-trips`);
    // classic_refresh.rs: snapshot W, registry R, execution W, primary then converter externals; no sysvar for CPMM rows.
    assert.deepEqual(ix.accounts.map((m) => [m.address, m.isWritable]), [[SNAPSHOT, true], [REGISTRY, false], [EXECUTION, true],
      ...[...primary, ...converter].flatMap((r) => r.externals.map((x) => [x, false]))]);
    assert.equal(ix.accounts.length, 3 + 4 + 5 * s);
  }
  assert.deepEqual(mimirClassicSampleOnlyRows(layout, 1), Array.from({ length: s }, (_, r) => 1 + r), "R10: sample-only selects every converter row, not the spot primary");
  assert.throws(() => mimirClassicRow({ role: "converter", adapterType: 2, adapterVersion: 0, currentPoint: false, sourceConfig: key(300), feedConfig: CONV_FEED,
    sourcingPlan: CONV_PLAN, adapterAccounts: row("primary", 0).externals, witness: witness(convFeedId, 0) }), /duration-bearing/, "spot converter rejected");

  // ABI-1 gate on the exact ordered primary+converter recipes, action and converter count; localnet stays open.
  const dlmmConverter = deriveMimirClassicRecipe({ role: "converter", adapterType: 3, adapterVersion: 0, externalWidth: 9, minSlotGap: 1, accountsBindingVersion: 1 });
  const recipes = [...primary.map((r) => r.recipe), ...converter.map(() => dlmmConverter)];
  const cell = (id: string, action: MimirBankCellV1["action"], recipe: string): MimirBankCellV1 => ({ id, fixtureSha256: "1".repeat(64), action, recipe,
    sourceCount: w, converter: true, executionKind: "classic", primarySourceCount: w - s, converterSourceCount: s, recipeTupleKeys: recipes.map(mimirRecipeTupleKey), keys: 30, bytes: 1_000, instructions: 1, signers: 1, freeKeys: 34, cuBefore: null, cuAfter: 100_000,
    outputSha256: "2".repeat(64), status: "measured", instructionsSha256: "3".repeat(64) });
  const tuples = [...new Map(recipes.map((r) => [mimirRecipeTupleKey(r), r])).values()];
  const cells = (["fresh-creation", "publish"] as const).map((a) => cell(a, a, mimirRecipeTupleKey(recipes[0]!)));
  // Gate-logic fixture only, not release evidence.
  const capability = { manifestSha256: "", cells: new Map(cells.map((c) => [c.id, c])), manifest: { clusterGenesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", programId: PROGRAM, recipes: tuples.map((r) => ({
    adapterType: r.adapterType, adapterVersion: r.adapterVersion, mode: r.mode, temporalKind: r.temporalKind, externalWidth: r.externalWidth,
    bindingWidth: r.bindingWidth, accountsBindingVersion: r.accountsBindingVersion, bindingVariant: mimirFusedRecipeBindingVariant(r), clusterEnabled: true,
    exactElfCells: { "fresh-creation": ["fresh-creation"], publish: ["publish"] } })) } } as unknown as MimirAbi1Capability;
  const gate = (over: object) => () => assertMimirAbi1Capable({ cluster: "devnet", programId: PROGRAM, capability, recipes, action: "fresh-creation",
    executionKind: "classic", converterSourceCount: s, ...over });
  assert.doesNotThrow(gate({}));
  assert.doesNotThrow(gate({ action: "publish" }));
  assert.throws(gate({ capability: undefined }), /no verified capability/, "absent");
  assert.throws(gate({ programId: key(99) }), /no verified capability/, "wrong program");
  assert.throws(gate({ action: "init" }), /no measured classic init primary cell/, "wrong action");
  assert.throws(gate({ converterSourceCount: 0 }), /no measured|row domains/, "wrong shape: converter flag");
  assert.throws(gate({ action: "sample" }), /no measured classic sample primary cell/, "sample is its own action");
  assert.throws(gate({ executionKind: "composite" }), /no measured/, "wrong kind");
  assert.throws(gate({ recipes: recipes.slice(0, w - 1) }), /no measured|row domains/, "wrong shape: row set");
  assert.doesNotThrow(gate({ cluster: "localnet", capability: undefined }), "localnet");
}
// R12 mixed converter: CLMM v0 native E8 + DLMM v0 native E7/E9 seal admitted, and recurring refresh slices each row to its sealed width.
{
  const conv = (adapterType: number, n: number, i: number) => mimirClassicRow({ role: "converter", adapterType, adapterVersion: 0, currentPoint: false,
    sourceConfig: key(300 + i), feedConfig: CONV_FEED, sourcingPlan: CONV_PLAN, adapterAccounts: Array.from({ length: n }, (_, j) => key(3000 + i * 20 + j)),
    witness: witness(convFeedId, i) });
  const converter = [conv(1, 8, 0), conv(3, 7, 1), conv(3, 9, 2)]; const primary = [row("primary", 0)];
  assert.deepEqual(converter.map((r) => [r.recipe.adapterType, r.recipe.mode, r.recipe.externalWidth]), [[1, 2, 8], [3, 2, 7], [3, 2, 9]]);
  const layout = mimirClassicExecutionLayout(primary.map((r) => r.recipe), converter.map((r) => r.recipe));
  buildMimirInitFusedClassicClosure({ programId: PROGRAM, payer: PAYER, execution: EXECUTION, collateralLock: key(990), snapshot: SNAPSHOT, feedConfig: FEED,
    sourcingPlan: PLAN, registry: REGISTRY, feedId, layout, witnesses: [...primary, ...converter].map((r) => r.witness), primary,
    converter: { feedConfig: CONV_FEED, sourcingPlan: CONV_PLAN, sources: converter } });
  const spare = (r: (typeof converter)[number], n: number) => [...r.externals, ...Array.from({ length: n }, (_, j) => key(3900 + j))];
  const sliced = classicRowExternals(layout.descriptors.slice(1), { adapterAccounts: converter.map((r) => spare(r, 2)), cpmmPins: [key(31), key(32)],
    generationCluster: "mainnet" } as never);
  assert.deepEqual(sliced, converter.map((r) => [...r.externals]), "CLMM E8 keeps its observation tail, DLMM E7/E9 keep theirs");
  assert.throws(() => conv(1, 9, 3), /CLASSIC_CONVERTER_UNSUPPORTED|duration-bearing|adapter/, "CLMM v1-width row is not a v0 native converter");
}

console.log("classicConverterA2 ok");

// N1 current-point primary + S5 native DLMM E9 converters: the ready-only initializer exceeds the 64-account packet, so the staged
// point fallback must refuse it as classic:ready before any collateral decision.
{
  const { compileMimirBetaTransactionV1 } = await import("../src/beta/transactionV1.js");
  const { mimirBetaPacketRefusal } = await import("../src/beta/creation.js");
  const { MimirBetaPacketRefusalError } = await import("../src/beta/errors.js");
  const primary = deriveMimirClassicRecipe({ role: "primary", adapterType: 4, adapterVersion: 0, externalWidth: 8, temporalModuleVersion: 4, currentPoint: true, minSlotGap: 0, accountsBindingVersion: 1 });
  const converter = deriveMimirClassicRecipe({ role: "converter", adapterType: 3, adapterVersion: 0, externalWidth: 9, minSlotGap: 1, accountsBindingVersion: 1 });
  const layout = mimirClassicExecutionLayout([primary], Array(5).fill(converter));
  const witness = (i: number) => ({ feedId: new Uint8Array(32).fill(i + 1), sourceIndex: i === 0 ? 0 : i - 1, ringVersion: 1, minSlotGap: i === 0 ? 0 : 1,
    expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n, expectedPlanHash: new Uint8Array(32).fill(1),
    sourceSetSiblings: [1, 2, 3].map(() => new Uint8Array(32)), accountsSiblings: [1, 2, 3].map(() => new Uint8Array(32)) });
  const row = (i: number, width: number) => ({ sourceConfig: key(1100 + i), externals: Array.from({ length: width }, (_, j) => key(1200 + i * 20 + j)) });
  const instructions = buildMimirInitFusedClassicClosure({ programId: key(1001), payer: key(1002), execution: key(1003), collateralLock: key(1099), snapshot: key(1004), feedConfig: key(1005),
    sourcingPlan: key(1006), registry: key(1007), feedId: new Uint8Array(32).fill(8), layout, witnesses: Array.from({ length: 6 }, (_, i) => witness(i)),
    primary: [row(0, 8)], converter: { feedConfig: key(1009), sourcingPlan: key(1010), sources: Array.from({ length: 5 }, (_, i) => row(i + 1, 9)) } });
  const error = await compileMimirBetaTransactionV1({ feePayer: key(1002), recentBlockhash: key(1011), lastValidBlockHeight: 0n, instructions }).catch((e: unknown) => e);
  assert.match(String(error), /64 accounts/);
  const refusal = await mimirBetaPacketRefusal("classic:ready", key(1002), instructions, { source0: row(0, 8).externals }, error as Error);
  assert.ok(refusal instanceof MimirBetaPacketRefusalError && refusal.stage === "classic:ready");
}
