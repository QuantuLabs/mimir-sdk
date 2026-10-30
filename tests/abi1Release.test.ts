import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Address } from "@solana/kit";
import {
  admitMimirTxV1Packet, assertMimirAbi1Capable, mimirCompositeWitnessA2, mimirClassicCellSignature, mimirRecipeTupleKey, verifyMimirCuEvidenceA2, mimirCompositeCellSignature, mimirInstructionsSha256, mimirSortedJsonSha256, observeMimirAbi1Deployment, preflightMimirConsumerAdmissionV1,
  prepareMimirStandalonePublication, verifyMimirAbi1Capability, type MimirConsumerBudgetPayloadV1, type MimirCapabilityManifestV1,
} from "../src/beta/abi1Release.js";
import {
  buildMimirFusedCompositeRefreshInstruction, buildMimirInitFusedCompositeClosure, deriveMimirFusedRecipe, mimirCompositeExecutionLayout,
  type MimirFusedRecipe,
} from "../src/beta/compositeExecution.js";
import { encodeMimirFusedClassicData } from "../src/beta/classicExecution.js";
import { addressBytes, bytesAddress, fromHex, hex, sha256 } from "../src/beta/bytes.js";
import type { MimirBetaInstruction } from "../src/beta/types.js";
import { MimirBetaSimulationError } from "../src/beta/errors.js";

const key = (n: number) => bytesAddress(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n & 255 : i === 1 ? n >> 8 : 7)));
const PROGRAM = "4kxKWPhWUZMj1x2D2BaCBW9BfeBZ6po4WagfzkUCsAt4" as Address;
const throwsCode = async (p: Promise<unknown>, re: RegExp) => assert.rejects(p, (e: Error) => re.test(e.message));
// Synthetic ELF bytes exercising the gate logic only (non-zero last byte). The manifest below is mock data, not bank evidence.
const elf = Uint8Array.from({ length: 4096 }, (_, i) => ((i * 31 + 7) & 255) || 1);
const elfSha = hex(await sha256(elf));
const MOCK_SOURCE_COMMIT = "f".repeat(40);
const MOCK_CU = 90_000;
// PHONES init packet census (SDK TxV1 compile), used as mocked input for the gate logic.
const phonesInit = JSON.parse(readFileSync(new URL("./fixtures/abi1/phones-init-packet.json", import.meta.url), "utf8")) as
  { payer: Address; instructions: { programAddress: Address; accounts: MimirBetaInstruction["accounts"]; dataHex: string }[] };
const phonesInitIxs: MimirBetaInstruction[] = phonesInit.instructions.map((ix) => ({ ...ix, data: fromHex(ix.dataHex) }));
// Historical provenance only: the PHONES bank cell was measured on ELF f3d8e5f4, not on the synthetic bytes above.
{
  const prov = JSON.parse(readFileSync(new URL("./fixtures/abi1/PROVENANCE.json", import.meta.url), "utf8"));
  assert.equal(prov.elf.sha256.slice(0, 8), "f3d8e5f4"); assert.equal(prov.elf.sourceCommit, "1fdb4970eccb27516d3fd6d83b5588d7074dc052");
  assert.deepEqual([prov.cells["fused-phones-init"].cu, prov.cells["fused-phones-init"].status], [97048, "measured"]);
}
const cpmm = deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 4, minSlotGap: 1, accountsBindingVersion: 1 });

const PHONES_INIT_FIXTURE_SHA = hex(await sha256(readFileSync(new URL("./fixtures/abi1/phones-init-packet.json", import.meta.url))));
const MOCK_OUTPUT_SHA = "e".repeat(64);
const PHONES_INIT_IXS_SHA = await mimirInstructionsSha256(phonesInitIxs);
assert.equal(PHONES_INIT_IXS_SHA, "dd07398a7b829bf7d5c738e3419381f8d28e58d680a9b3c8063d35c474205d42");
const manifestBase = (): MimirCapabilityManifestV1 => ({
  schema: "mimir-capability-manifest-a2-v3", abi: "ABI-1+A2", clusterGenesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", programId: PROGRAM,
  programDataAddress: key(900), deploymentSlot: 1234, sourceCommit: MOCK_SOURCE_COMMIT, elfSha256: elfSha, elfLength: elf.length,
  sdkVersion: (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string }).version,
  sdkTarballSha256: "0".repeat(64), appCommit: "app", indexerCommit: "c980c1d",
  tags: { fusedClassic: 89, initFusedClassic: 90, fusedComposite: 87, initFusedComposite: 88 },
  removedTags: [59, 60, 65, 66, 67, 68, 69, 70, 71, 72, 77, 82, 83],
  state: { cfcLength: 661, cspLength: 720, classicSnapshotLength: 512, executionMagic: "MIMIRCEF", executionVersion: 1, executionSeed: "composite_execution",
    headerLength: 128, componentRowLength: 1621, converterFixedLength: 1829, converterSourceRowLength: 944, membershipRecordHeaderLength: 4,
    physicalIdentityLength: 65, maxBindingWidth: 8, transactionClosedInit: true, freshCfcSameTx: true, lazyInit: false,
    classicExecutionMagic: "MIMIRCLX", classicExecutionSeed: "classic_execution", classicHeaderLength: 384, classicProofLength: 256, classicRowLength: 944 },
  limits: { staticKeys: 64, targetMaxKeys: 54, bytes: 4096, outerInstructions: 64, cu: 1_400_000, reallocGrowth: 10_240 },
  recipes: [{ adapterType: 2, adapterVersion: 0, mode: 6, temporalKind: 0, externalWidth: 4, bindingWidth: 4, accountsBindingVersion: 1, bindingVariant: 0,
    clusterEnabled: true, exactElfCells: { init: ["mock-packet-init"], publish: ["synthetic-n2-publish"] } }],
  consumerBudgets: [],
  bank: { runnerSha256: "1".repeat(64), candidateElfSha256: elfSha, cells: [
    // Mocked input, not bank evidence: packet census with mock CU and output hash.
    { id: "mock-packet-init", fixtureSha256: PHONES_INIT_FIXTURE_SHA, action: "init", recipe: mimirRecipeTupleKey(cpmm), sourceCount: 3, converter: false,
      executionKind: "composite", primarySourceCount: 3, converterSourceCount: 0, recipeTupleKeys: [1, 2, 3].map(() => mimirRecipeTupleKey(cpmm)),
      keys: 26, bytes: 1_973, instructions: 2, signers: 1, freeKeys: 38, cuBefore: null, cuAfter: MOCK_CU, outputSha256: MOCK_OUTPUT_SHA,
      status: "measured", instructionsSha256: PHONES_INIT_IXS_SHA },
    // Gate-logic fixture only (not release evidence): an N2 publish cell so D3 exercises the per-action, per-shape match.
    { id: "synthetic-n2-publish", fixtureSha256: "4".repeat(64), action: "publish", recipe: mimirRecipeTupleKey(cpmm), sourceCount: 2, converter: false,
      executionKind: "composite", primarySourceCount: 2, converterSourceCount: 0, recipeTupleKeys: [1, 2].map(() => mimirRecipeTupleKey(cpmm)),
      keys: 30, bytes: 1_000, instructions: 1, signers: 1, freeKeys: 34, cuBefore: null, cuAfter: 82_258, outputSha256: "5".repeat(64),
      status: "measured", instructionsSha256: "c".repeat(64) },
    // Unmeasured shapes stay OPEN; this one only exercises the refusal of a non-measured cell.
    { id: "modelled", fixtureSha256: "6".repeat(64), action: "publish", recipe: "dlmm", sourceCount: 5, converter: true, keys: 66, bytes: 0,
      executionKind: "classic", primarySourceCount: 4, converterSourceCount: 1, recipeTupleKeys: Array(5).fill("dlmm"),
      instructions: 1, signers: 1, freeKeys: -2, cuBefore: null, cuAfter: 100_000, outputSha256: "7".repeat(64), status: "model", instructionsSha256: "d".repeat(64) }] },
  frameGate: { toolchain: "platform-tools", passed: true, logSha256: "8".repeat(64) },
  review: { daybreakMaxReportSha256: "9".repeat(64), ponytailReportSha256: "a".repeat(64) },
});

const CASES = ["Activate", "Open", "CloseFull", "Liquidate"] as const;
const PAYLOAD: MimirConsumerBudgetPayloadV1 = { schema: "mimir-consumer-budget-a2-v1", consumer: "example-perps", cluster_genesis_hash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  mimir_program_id: PROGRAM, consumer_program_ids: [key(950), key(951)],
  limits: { keys: 64, targetMaxKeys: 54, bytes: 4096, instructions: 64, cu: 1_400_000 }, cases: CASES, cells: [] };
const contractOf = async (payload: MimirConsumerBudgetPayloadV1 = PAYLOAD) => {
  const sha = await mimirSortedJsonSha256(payload);
  return { contract: { contract_sha256: sha, payload }, sha };
};

// Deployment observation from upgradeable-loader accounts.
const programAccount = new Uint8Array(36); new DataView(programAccount.buffer).setUint32(0, 2, true);
programAccount.set((await import("../src/beta/bytes.js")).addressBytes(key(900)), 4);
const pdAccount = new Uint8Array(45 + elf.length + 16); new DataView(pdAccount.buffer).setUint32(0, 3, true); new DataView(pdAccount.buffer).setBigUint64(4, 1234n, true);
pdAccount.set(elf, 45);
const accounts = new Map<string, Uint8Array>([[PROGRAM, programAccount], [key(900), pdAccount]]);
const observe = (elfLength = elf.length) => observeMimirAbi1Deployment({ programId: PROGRAM, elfLength, clusterGenesisHash: manifestBase().clusterGenesisHash,
  readAccount: async (a) => accounts.has(a) ? { owner: "BPFLoaderUpgradeab1e11111111111111111111111" as Address, data: accounts.get(a)! } : null });
const observed = await observe();
assert.deepEqual([observed.programDataAddress, observed.deploymentSlot, observed.elfSha256], [key(900), 1234, elfSha]);
await throwsCode(observe(elf.length - 1 - [...elf].reverse().findIndex((b) => b !== 0)), /ELF length/);

const { contract, sha: contractSha } = await contractOf();
const manifest = { ...manifestBase(), consumerBudgets: [{ schema: "mimir-consumer-budget-a2-v1" as const, sha256: contractSha }] };
const manifestSha = await mimirSortedJsonSha256(manifest);
const verify = (m: MimirCapabilityManifestV1 = manifest, extra: Partial<Parameters<typeof verifyMimirAbi1Capability>[0]> = {}) =>
  verifyMimirAbi1Capability({ manifest: m, expectedManifestSha256: extra.expectedManifestSha256 ?? (m === manifest ? manifestSha : ""), observed,
    consumerContractSha256: contractSha, recipes: [cpmm, cpmm, cpmm], packet: { action: "init", executionKind: "composite", converterSourceCount: 0 }, ...extra });
const capability = await verify();
assert.equal(capability.manifestSha256, manifestSha);
{
  const packet = { programId: PROGRAM, capability, recipes: [cpmm, cpmm, cpmm], action: "init" as const,
    executionKind: "composite" as const, converterSourceCount: 0 };
  const main = { ...capability, manifest: { ...capability.manifest, clusterGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" } };
  assert.doesNotThrow(() => assertMimirAbi1Capable({ ...packet, cluster: "devnet" }));
  for (const cluster of ["mainnet", "mainnet-beta"]) {
    assert.doesNotThrow(() => assertMimirAbi1Capable({ ...packet, cluster, capability: main }));
    assert.throws(() => assertMimirAbi1Capable({ ...packet, cluster }), /canonical mainnet-beta genesis/);
  }
  assert.throws(() => assertMimirAbi1Capable({ ...packet, cluster: "devnet", capability: main }), /canonical devnet genesis/);
  assert.throws(() => assertMimirAbi1Capable({ ...packet, cluster: "testnet" }), /canonical testnet genesis/);
  assert.doesNotThrow(() => assertMimirAbi1Capable({ ...packet, cluster: "localnet", capability: undefined }));
}

// Every identity/frozen-field mismatch fails closed.
for (const [label, patch] of [
  ["genesis", { clusterGenesisHash: "x" }], ["program data", { programDataAddress: key(901) }], ["slot", { deploymentSlot: 1 }], ["elf", { elfSha256: "f".repeat(64) }],
  ["tags", { tags: { ...manifest.tags, fusedComposite: 65 } }], ["removed", { removedTags: [65, 66] }], ["state", { state: { ...manifest.state, lazyInit: true } }],
  ["limits", { limits: { ...manifest.limits, staticKeys: 65 } }], ["frame", { frameGate: { ...manifest.frameGate, passed: false } }],
  ["bank elf", { bank: { ...manifest.bank, candidateElfSha256: "e".repeat(64) } }],
  ["recipe cell", { recipes: [{ ...manifest.recipes[0]!, exactElfCells: { init: ["modelled"] } }] }],
  ["no init cell", { recipes: [{ ...manifest.recipes[0]!, exactElfCells: { publish: ["synthetic-n2-publish"] } }] }],
  ["scalar cell", { recipes: [{ ...manifest.recipes[0]!, exactElfCells: { init: "mock-packet-init" } }] }],
  ["duplicate recipe tuple", { recipes: [manifest.recipes[0]!, { ...manifest.recipes[0]!, clusterEnabled: false }] }],
  ["duplicate cell id", { bank: { ...manifest.bank, cells: [...manifest.bank.cells, { ...manifest.bank.cells[0]!, cuAfter: 1 }] } }],
  ["duplicate candidate", { recipes: [{ ...manifest.recipes[0]!, exactElfCells: { init: ["mock-packet-init", "mock-packet-init"] } }] }],
  ["ambiguous", { recipes: [{ ...manifest.recipes[0]!, exactElfCells: { init: ["mock-packet-init", "phones-init-twin"] } }],
    bank: { ...manifest.bank, cells: [...manifest.bank.cells, { ...manifest.bank.cells[0]!, id: "phones-init-twin" }] } }],
  ["binding variant", { recipes: [{ ...manifest.recipes[0]!, bindingVariant: 1 }] }],
  ...([["action", { action: "publish" }], ["recipe tuple", { recipe: "2.0.m6.k0.E4.K4.b1.v1" }], ["source count", { sourceCount: 2 }],
    ["converter", { converter: true }], ["kind", { executionKind: "classic" }],
    ["converter-only role", { primarySourceCount: 1, converterSourceCount: 2, converter: true, recipeTupleKeys: ["2.0.m0.k0.E4.K4.b1.v0", mimirRecipeTupleKey(cpmm), mimirRecipeTupleKey(cpmm)] }],
    ["N+S", { primarySourceCount: 2 }], ["cu zero", { cuAfter: 0 }], ["cu over limit", { cuAfter: 1_400_001 }],
    ["instructions hash", { instructionsSha256: "z".repeat(64) }], ["fixture", { fixtureSha256: "" }], ["output", { outputSha256: "x" }], ["cu", { cuAfter: null }]] as const)
    .map(([label, cell]) => [`cell ${label}`, { bank: { ...manifest.bank, cells: manifest.bank.cells.map((c) => c.id === "mock-packet-init" ? { ...c, ...cell } : c) } }] as const),
  ["recipe disabled", { recipes: [{ ...manifest.recipes[0]!, clusterEnabled: false }] }],
] as const) {
  const m = { ...manifest, ...patch } as MimirCapabilityManifestV1;
  await throwsCode(verify(m, { expectedManifestSha256: await mimirSortedJsonSha256(m) }), /capability mismatch|release recipe scope/);
  void label;
}
await throwsCode(verify(manifest, { expectedManifestSha256: "0".repeat(64) }), /manifest hash/);
// Every referenced witness is validated at verification time, even when no recipe is requested.
for (const cell of [{ cuAfter: 0 }, { cuAfter: 1_400_001 }, { status: "modelled" }, { outputSha256: "x" }, { primarySourceCount: 6, sourceCount: 6 },
  { recipe: "9.0.m0.k0.E4.K4.b1.v0", recipeTupleKeys: ["9.0.m0.k0.E4.K4.b1.v0", "9.0.m0.k0.E4.K4.b1.v0"] }]) {
  const m = { ...manifest, bank: { ...manifest.bank, cells: manifest.bank.cells.map((c) => c.id === "synthetic-n2-publish" ? { ...c, ...cell } : c) } } as MimirCapabilityManifestV1;
  await throwsCode(verify(m, { expectedManifestSha256: await mimirSortedJsonSha256(m), recipes: undefined }), /capability mismatch/);
}
// Off localnet, every tag-87/88 producer requires this program's verified capability and measured recipe cells.
{
  const { assertMimirAbi1Capable, assertMimirAbi1RecipesCapable, assertMimirCapabilitySdkPackage } = await import("../src/beta/abi1Release.js");
  const dlmm = deriveMimirFusedRecipe({ role: "component", adapterType: 3, adapterVersion: 0, externalWidth: 6, minSlotGap: 1, accountsBindingVersion: 1 });
  const init = { action: "init", executionKind: "composite", converterSourceCount: 0 } as const;
  assert.doesNotThrow(() => assertMimirAbi1Capable({ cluster: "localnet", programId: PROGRAM, recipes: [dlmm], ...init }));
  assert.doesNotThrow(() => assertMimirAbi1Capable({ cluster: "devnet", programId: PROGRAM, capability, recipes: [cpmm, cpmm, cpmm], ...init }));
  assert.throws(() => assertMimirAbi1Capable({ cluster: "devnet", programId: PROGRAM, recipes: [cpmm, cpmm, cpmm], ...init }), /no verified capability/);
  assert.throws(() => assertMimirAbi1Capable({ cluster: "devnet", programId: key(5), capability, recipes: [cpmm, cpmm, cpmm], ...init }), /no verified capability/);
  assert.throws(() => assertMimirAbi1Capable({ cluster: "devnet", programId: PROGRAM, capability, recipes: [dlmm], ...init }), /recipe 3\.0\.m0\.k0\.E6/);
  // Coverage is per row: action, execution kind and role must be measured; exact shape is optional provenance.
  for (const packet of [{ ...init, action: "fresh-creation" }, { ...init, action: "sample" }, { ...init, converterSourceCount: 1 },
    { ...init, executionKind: "classic" }] as const) {
    assert.throws(() => assertMimirAbi1Capable({ cluster: "devnet", programId: PROGRAM, capability, recipes: [cpmm, cpmm, cpmm], ...packet }), /no measured|scalar converter math/);
  }
  assert.equal(assertMimirAbi1RecipesCapable(capability, [cpmm, cpmm], init), null);
  assert.equal(assertMimirAbi1RecipesCapable(capability, [cpmm, cpmm, cpmm, cpmm], init), null);
  assert.equal(assertMimirAbi1RecipesCapable(capability, [cpmm, cpmm, cpmm, cpmm, cpmm], init), null);
  for (const [recipes, s] of [[[], 0], [[cpmm, cpmm, cpmm, cpmm, cpmm, cpmm], 0], [[cpmm], 1], [Array(11).fill(cpmm), 6]] as const) {
    assert.throws(() => assertMimirAbi1RecipesCapable(capability, recipes, { ...init, converterSourceCount: s }), /row domains/);
  }
  assert.throws(() => assertMimirAbi1RecipesCapable(capability, [cpmm, cpmm], { ...init, converterSourceCount: 0.5 }), /row domains/);
  const twin = { ...manifest.bank.cells[0]!, id: "phones-init-twin" };
  const ambiguous = { ...capability, cells: new Map([...capability.cells, [twin.id, twin]]),
    manifest: { ...manifest, recipes: [{ ...manifest.recipes[0]!, exactElfCells: { init: ["mock-packet-init", twin.id] } }] } };
  assert.throws(() => assertMimirAbi1Capable({ cluster: "devnet", programId: PROGRAM, capability: ambiguous, recipes: [cpmm, cpmm, cpmm], ...init }), /ambiguous init cell/);
  assert.equal(assertMimirAbi1RecipesCapable(ambiguous, [cpmm, cpmm], init), null);
  const n2 = manifest.bank.cells[1]!;
  const sample = { ...n2, id: "synthetic-n2-sample", action: "sample" };
  const multi = { ...capability, cells: new Map([...capability.cells, [sample.id, sample]]), manifest: { ...manifest, recipes: [{ ...manifest.recipes[0]!,
    exactElfCells: { init: ["mock-packet-init"], publish: ["synthetic-n2-publish"], sample: [sample.id] } }] } };
  assert.equal(assertMimirAbi1RecipesCapable(multi, [cpmm, cpmm], { action: "sample", executionKind: "composite", converterSourceCount: 0 }), "synthetic-n2-sample");
  assert.equal(assertMimirAbi1RecipesCapable(multi, [cpmm, cpmm], { action: "publish", executionKind: "composite", converterSourceCount: 0 }), "synthetic-n2-publish");
  assert.equal(assertMimirAbi1RecipesCapable(capability, [cpmm, cpmm, cpmm], init), "mock-packet-init");
  const pub = { ...init, action: "publish" } as const;
  assert.equal(assertMimirAbi1RecipesCapable(multi, [cpmm, cpmm, cpmm, cpmm], pub), null);
  assert.equal(assertMimirAbi1RecipesCapable(multi, [cpmm], pub), null);
  // Mixed families, repeated rows, permutations and a trailing converter admit from per-role evidence; exact multisets keep their ID.
  const [kc, kd] = [mimirRecipeTupleKey(cpmm), mimirRecipeTupleKey(dlmm)];
  const capOf = (r: MimirFusedRecipe) => ({ ...manifest.recipes[0]!, adapterType: r.adapterType, adapterVersion: r.adapterVersion, mode: r.mode, temporalKind: r.temporalKind,
    externalWidth: r.externalWidth, bindingWidth: r.bindingWidth, accountsBindingVersion: r.accountsBindingVersion, bindingVariant: Number(mimirRecipeTupleKey(r).split(".v")[1]) });
  const mixed = (cells: Record<string, unknown>[], dlmmPatch: Record<string, unknown> = {}, other = dlmm) => ({ ...capability, cells: new Map(cells.map((c) => [c.id as string, c])),
    manifest: { ...manifest, recipes: [{ ...manifest.recipes[0]!, exactElfCells: { publish: cells.map((c) => c.id) } },
      { ...capOf(other), exactElfCells: { publish: cells.map((c) => c.id) }, ...dlmmPatch }] } }) as unknown as typeof capability;
  const c3 = { ...n2, id: "mixed-n3", sourceCount: 3, primarySourceCount: 3, recipeTupleKeys: [kc, kd, kc] };
  for (const order of [[cpmm, cpmm, dlmm], [dlmm, cpmm, cpmm], [cpmm, dlmm, cpmm]]) assert.equal(assertMimirAbi1RecipesCapable(mixed([c3]), order, pub), "mixed-n3");
  for (const order of [[cpmm, dlmm, dlmm], [dlmm, dlmm, dlmm, dlmm], [cpmm, dlmm, cpmm, dlmm, cpmm]]) assert.equal(assertMimirAbi1RecipesCapable(mixed([c3]), order, pub), null);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([c3], { clusterEnabled: false }), [cpmm, dlmm], pub), /recipe 3\.0\.m0\.k0\.E6.* is outside the pinned release recipe scope/);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([c3], { exactElfCells: {} }), [cpmm, dlmm], pub), /no measured composite publish primary/);
  // Converter rows are the scalar converter math's native DLMM/CLMM v0 tuples; a spot or CPMM converter refuses even with full evidence.
  const dn = deriveMimirFusedRecipe({ role: "converter", adapterType: 3, adapterVersion: 0, externalWidth: 9, minSlotGap: 1, accountsBindingVersion: 1 });
  const kn = mimirRecipeTupleKey(dn);
  const conv = { ...c3, id: "mixed-n2s1", primarySourceCount: 2, converterSourceCount: 1, converter: true, recipeTupleKeys: [kc, kc, kn] };
  const s1 = { ...pub, converterSourceCount: 1 };
  assert.equal(assertMimirAbi1RecipesCapable(mixed([conv], {}, dn), [cpmm, cpmm, dn], s1), "mixed-n2s1");
  assert.equal(assertMimirAbi1RecipesCapable(mixed([conv], {}, dn), [cpmm, cpmm, cpmm, cpmm, dn], s1), null);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([conv], {}, dn), [cpmm, dn, dn], s1), /no measured composite publish primary/);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([conv], { clusterEnabled: false }, dn), [cpmm, cpmm, dn], s1), /outside the pinned release recipe scope/);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([conv], {}, dn), [cpmm, cpmm, cpmm], s1), /not consumable by the scalar converter math/);
  const spotConv = { ...conv, id: "spot-n2s1", recipeTupleKeys: [kc, kc, kd] };
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([spotConv]), [cpmm, cpmm, dlmm], s1), /not consumable by the scalar converter math/);
  // A sampled mode-4 arm is outside the release scope even when enabled and measured.
  const m4 = deriveMimirFusedRecipe({ role: "component", adapterType: 4, adapterVersion: 0, externalWidth: 8, temporalModuleVersion: 4, minSlotGap: 1, accountsBindingVersion: 1 });
  const c4 = { ...n2, id: "mode4-n2", recipeTupleKeys: [kc, mimirRecipeTupleKey(m4)] };
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([c4], {}, m4), [cpmm, m4], pub), /mode-4 arm outside the release recipe scope/);
  // A classic primary never authorizes a composite converter, nor a composite primary a classic one.
  const classicConv = { ...conv, id: "classic-n2s1", executionKind: "classic" };
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([c3, classicConv], {}, dn), [cpmm, dn], s1), /no measured composite publish converter/);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([c3, { ...c3, id: "mixed-n3-twin", recipeTupleKeys: [kd, kc, kc] }]), [cpmm, dlmm, cpmm], pub),
    /ambiguous publish/);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([{ ...c3, fixtureSha256: "x" }]), [cpmm, dlmm], pub), /no measured/);
  assert.throws(() => assertMimirAbi1RecipesCapable(mixed([{ ...c3, cuAfter: null }]), [cpmm, dlmm], pub), /no measured/);
  assertMimirCapabilitySdkPackage(manifest, { version: manifest.sdkVersion, tarballSha256: manifest.sdkTarballSha256 });
  assert.throws(() => assertMimirCapabilitySdkPackage(manifest, { version: "0.0.0", tarballSha256: manifest.sdkTarballSha256 }), /SDK package/);
  assert.throws(() => assertMimirCapabilitySdkPackage(manifest, { version: manifest.sdkVersion, tarballSha256: "1".repeat(64) }), /SDK package/);
}
await throwsCode(verify(manifest, { consumerContractSha256: "0".repeat(64) }), /consumer budget/);

// Exact Mimir producer: N2 CPMM tag 87, plus the tag-88 initializer for the same composite.
const layout = mimirCompositeExecutionLayout([cpmm, cpmm], []);
const feed = new Uint8Array(32).fill(5);
const roles = { payer: key(1), csp: key(2), cfc: key(3), registry: key(4), admin: key(5), witness: key(6) } as const;
const tag87 = (l = layout, recipes: MimirFusedRecipe[] = [cpmm, cpmm], converter: number[] = []) => buildMimirFusedCompositeRefreshInstruction({
  programId: PROGRAM, payer: roles.payer, compositeSnapshot: roles.csp, compositeConfig: roles.cfc, registry: roles.registry, adminConfig: roles.admin,
  feeVault: key(7), treasury: key(8), execution: key(9), layout: l,
  componentExternals: recipes.map((r, i) => Array.from({ length: r.externalWidth }, (_, j) => key(100 + i * 10 + j))),
  converterExternals: converter.map((w, i) => Array.from({ length: w }, (_, j) => key(300 + i * 10 + j))),
  request: { compositeFeedId: feed, expectedConfigRevision: 1n, previousSnapshotRevision: 4n, nextSnapshotRevision: 5n,
    componentSourceConfigRevisions: recipes.map(() => 1n), maxRefreshFeeLamports: 0n, componentRingNewestSlots: recipes.map(() => 0n),
    converterRingNewestSlots: converter.map(() => 0n) } });
const witness = (i: number) => ({ feedId: new Uint8Array(32).fill(i + 10), sourceIndex: 0, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n,
  expectedSourceSetRevision: 1n, expectedPlanHash: new Uint8Array(32), sourceSetSiblings: [0, 1, 2].map(() => new Uint8Array(32)), accountsSiblings: [0, 1, 2].map(() => new Uint8Array(32)) });
const initializer = buildMimirInitFusedCompositeClosure({ programId: PROGRAM, payer: roles.payer, execution: key(9), collateralLock: key(8), compositeConfig: roles.cfc, registry: roles.registry,
  compositeFeedId: feed, layout, witnesses: [witness(0), witness(1)], components: [0, 1].map((i) => ({ sourceConfig: key(200 + i), feedConfig: key(210 + i),
    sourcingPlan: key(220 + i), externals: Array.from({ length: 4 }, (_, j) => key(100 + i * 10 + j)) })) });
// A2 TxV1 compile admission from the actual key union.
{
  const ix = (n: number, base: number): MimirBetaInstruction => ({ programAddress: PROGRAM, data: new Uint8Array(4),
    accounts: Array.from({ length: n }, (_, i) => ({ address: key(base + i), isSigner: false, isWritable: false })) });
  const sources = [0, 1, 2, 3, 4].map((s) => Array.from({ length: 12 }, (_, i) => key(2000 + s * 20 + i)));
  const tag89 = { programAddress: PROGRAM, data: new Uint8Array(144), accounts: [roles.csp, roles.registry, key(9), ...sources.flat()].map((address) =>
    ({ address, isSigner: false, isWritable: false })) };
  const over = await admitMimirTxV1Packet({ payer: roles.payer, instructions: [tag89], cu: 100_000, roles: { primary: sources.flat() }, sources });
  assert.deepEqual([over.admitted, over.rejection, over.ownerTargetMet], [false, "TRANSPORT_KEYS", false]);
  assert.deepEqual(over.limitingRoles[0], { role: "primary", keys: 60 });
  assert.deepEqual(over.suggestedSourceCount, { hard: 4, owner: 4 }, "5 fixed keys + 12 per source");
  const fits = await admitMimirTxV1Packet({ payer: roles.payer, instructions: [ix(40, 3000)], cu: 1_400_000 });
  assert.deepEqual([fits.admitted, fits.keys, fits.ownerTargetMet, fits.suggestedSourceCount], [true, 42, true, null]);
  assert.equal((await admitMimirTxV1Packet({ payer: roles.payer, instructions: [ix(53, 3000)], cu: 1 })).ownerTargetMet, false, "55 keys: owner target reported");
  assert.equal((await admitMimirTxV1Packet({ payer: roles.payer, instructions: [ix(62, 3000)], cu: 1 })).admitted, true, "64 keys admits");
  assert.equal((await admitMimirTxV1Packet({ payer: roles.payer, instructions: [ix(4, 3000)], cu: null })).rejection, "UNKNOWN_CU");
  assert.equal((await admitMimirTxV1Packet({ payer: roles.payer, instructions: [ix(4, 3000)], cu: 1_400_001 })).rejection, "TRANSPORT_CU");
  assert.equal((await admitMimirTxV1Packet({ payer: roles.payer, instructions: [ix(4, 3000)], cu: 1, unsupportedCell: true })).rejection, "UNSUPPORTED_CELL");
  assert.equal((await admitMimirTxV1Packet({ payer: roles.payer, instructions: Array.from({ length: 65 }, () => ix(0, 0)), cu: 1 })).rejection, "TRANSPORT_INSTRUCTIONS");
  assert.equal((await admitMimirTxV1Packet({ payer: roles.payer, instructions: [{ ...ix(1, 3000), data: new Uint8Array(4_000) }], cu: 1 })).rejection, "TRANSPORT_BYTES");
}

// A2 creation preflight: no contract (C2 not yet published) or an unbanked cell fails closed; a measured in-limit cell admits.
{
  const cellId = mimirClassicCellSignature([cpmm, cpmm], 2);
  assert.equal(cellId, "classic:N2S0:2.0.m6.E4,2.0.m6.E4|");
  const capFor = (sha: string) => ({ ...capability, manifest: { ...manifest, consumerBudgets: [{ schema: "mimir-consumer-budget-a2-v1" as const, sha256: sha }] } });
  const none = await preflightMimirConsumerAdmissionV1({ cell: cellId });
  assert.deepEqual([none.admitted, none.rejection, none.contractSha256], [false, "UNKNOWN_CU", null]);
  const unbanked = await preflightMimirConsumerAdmissionV1({ contract, contractSha256: contractSha, capability, cell: cellId });
  assert.equal(unbanked.rejection, "UNKNOWN_CU");
  const cell = (action: "Activate" | "Open" | "CloseFull" | "Liquidate", over: object = {}) =>
    ({ case: action, cell: cellId, keys: 50, bytes: 2_000, instructions: 8, signers: 2, cu: 400_000, status: "measured" as const, ...over });
  const banked = await contractOf({ ...PAYLOAD, cells: (["Activate", "Open", "CloseFull", "Liquidate"] as const).map((a) => cell(a)) });
  const views = { initializer: { payer: roles.payer, instructions: initializer, cu: 60_000 }, freshCreation: { payer: roles.payer, instructions: initializer, cu: 70_000 } };
  const ok = await preflightMimirConsumerAdmissionV1({ contract: banked.contract, contractSha256: banked.sha, capability: capFor(banked.sha), cell: cellId, ...views });
  assert.deepEqual([ok.admitted, ok.ownerTargetMet, ok.contractSha256, ok.witness, ok.freshCreation!.cu], [true, true, banked.sha, null, 70_000]);
  const unlisted = await preflightMimirConsumerAdmissionV1({ contract: banked.contract, contractSha256: banked.sha, capability: { ...capability, manifest: { ...manifest, consumerBudgets: [] } }, cell: cellId, ...views });
  assert.deepEqual([unlisted.admitted, unlisted.contractSha256], [true, banked.sha], "a pinned contract need not be listed in the manifest");
  // Each applicable setup view is mandatory; a composite cell also needs its five-role witness.
  for (const missing of ["initializer", "freshCreation"] as const) {
    const { [missing]: _, ...rest } = views;
    assert.deepEqual((await preflightMimirConsumerAdmissionV1({ contract: banked.contract, contractSha256: banked.sha, capability: capFor(banked.sha), cell: cellId, ...rest })).reasons, ["SETUP_VIEW_MISSING"]);
  }
  const compositeCell = mimirCompositeCellSignature([cpmm, cpmm], 2);
  const compositeBanked = await contractOf({ ...PAYLOAD, cells: (["Activate", "Open", "CloseFull", "Liquidate"] as const).map((a) => ({ ...cell(a), cell: compositeCell })) });
  const noWitness = await preflightMimirConsumerAdmissionV1({ contract: compositeBanked.contract, contractSha256: compositeBanked.sha, capability: capFor(compositeBanked.sha), cell: compositeCell, ...views });
  assert.deepEqual(noWitness.reasons, ["WITNESS_MISSING"]);
  const withWitness = await preflightMimirConsumerAdmissionV1({ contract: compositeBanked.contract, contractSha256: compositeBanked.sha, capability: capFor(compositeBanked.sha), cell: compositeCell,
    ...views, witness: roles.witness });
  assert.deepEqual([withWitness.admitted, withWitness.witness], [true, roles.witness]);
  const [c0, c1, v0] = [key(200), key(201), key(300)].map((sourceConfig) => ({ sourceConfig }));
  assert.equal(mimirCompositeWitnessA2([c0!, c1!], [v0!]), v0!.sourceConfig, "converter composite: converter SourceConfig0, never component0");
  assert.equal(mimirCompositeWitnessA2([c0!, c1!], []), c0!.sourceConfig);
  const limited = await contractOf({ ...PAYLOAD, cells: [cell("Activate", { status: "KEY_LIMIT", cu: null, keys: 64 }), cell("Open", { keys: 55 }),
    cell("CloseFull", { status: "open", cu: null }), cell("Liquidate")] });
  const no = await preflightMimirConsumerAdmissionV1({ contract: limited.contract, contractSha256: limited.sha, capability: capFor(limited.sha), cell: cellId });
  assert.deepEqual(no.reasons, ["TRANSPORT_KEYS", "UNKNOWN_CU", "SETUP_VIEW_MISSING"]); assert.equal(no.ownerTargetMet, false);
  await throwsCode(preflightMimirConsumerAdmissionV1({ contract: banked.contract, contractSha256: contractSha, cell: cellId }), /hash-pinned/);
}

// Exact-packet CU evidence: a simulation receipt over the exact compiled message, or a cell whose action, instruction hash and census match.
{
  const { compileMimirBetaTransactionV1 } = await import("../src/beta/transactionV1.js");
  const blockhash = "11111111111111111111111111111111";
  const compiled = await compileMimirBetaTransactionV1({ feePayer: phonesInit.payer, recentBlockhash: blockhash, lastValidBlockHeight: 0n, instructions: phonesInitIxs });
  const sim = { recentBlockhash: blockhash, serializedMessageBase64: (await import("../src/beta/bytes.js")).base64(compiled.serializedMessage), unitsConsumed: MOCK_CU, err: null };
  const cu = (evidence: Parameters<typeof verifyMimirCuEvidenceA2>[0]["evidence"], over: Partial<Parameters<typeof verifyMimirCuEvidenceA2>[0]> = {}) =>
    verifyMimirCuEvidenceA2({ capability, action: "init", payer: phonesInit.payer, instructions: phonesInitIxs, evidence, ...over });
  assert.equal(await cu({ simulation: sim }), MOCK_CU);
  assert.equal(await cu({ cellId: "mock-packet-init" }), MOCK_CU);
  const otherIxs = [{ ...phonesInitIxs[0]!, data: Uint8Array.from(phonesInitIxs[0]!.data, (b, i) => i === 3 ? b ^ 1 : b) }, ...phonesInitIxs.slice(1)];
  for (const [label, value] of [["no evidence", await cu(null)], ["sim payer", await cu({ simulation: sim }, { payer: key(77) })],
    ["sim instructions", await cu({ simulation: sim }, { instructions: otherIxs })], ["sim fee config", await cu({ simulation: { ...sim, priorityFeeLamports: 50_000n } })],
    ["sim err", await cu({ simulation: { ...sim, err: { InstructionError: [0, "x"] } as never } })], ["sim units", await cu({ simulation: { ...sim, unitsConsumed: 0 } })],
    ["cell action", await cu({ cellId: "mock-packet-init" }, { action: "publish" })], ["cell instructions", await cu({ cellId: "mock-packet-init" }, { instructions: otherIxs })],
    ["cell payer census", await cu({ cellId: "mock-packet-init" }, { payer: key(77) })], ["cell model", await cu({ cellId: "modelled" })],
    ["cell unknown", await cu({ cellId: "nope" })]] as const) assert.equal(value, null, label);
}

// D3: trusted standalone admission over the accepted sealed-account fixtures.
{
  const { PublicKey } = await import("@solana/web3.js");
  const { createMimirRefreshGroupBuilder } = await import("../src/refreshGroup.js");
  const { decodeMimirClassicExecution } = await import("../src/beta/classicExecution.js");
  const { decodeMimirCompositeExecution } = await import("../src/beta/compositeExecution.js");
  const fixtureNames = ["classic-orca-e9.json", "classic-dlmm-native-routeable-e9.json", "composite-mode3-orca-damm.json",
    "composite-native-direct-point.json", "composite-native-direct-sampled.json", "composite-native-routeable-point.json", "classic-clmm-native-sparse.json"];
  const cases = [];
  for (const name of fixtureNames) {
    const fx = JSON.parse(readFileSync(new URL(`./fixtures/exportedRefresh/${name}`, import.meta.url), "utf8"));
    // Attested headers for admission only; preserve historical execution receipts.
    const generationHeaders: Record<string, string> = name === "classic-orca-e9.json" || name === "composite-mode3-orca-damm.json" ? {
      CtXfPzz36dH5Ws4UYKZvrQ1Xqzn42ecDW6y8NKuiN8nD: "AwAAACiXPxsAAAAAAezGza8ikrL73BJf2nvfj0M3epeaxgn4Is0mUqub30T8",
      AUh8bm2XsMfex3KjYGcM3G4uBqUNSDw6HEhWaWMYnyPH: "AwAAAM58PhsAAAAAAf7zIERSwsjzdXXYp+ML0Up9cSrp+/GpLweE+SsvY2H6",
    } : {};
    type Account = { owner: Address; executable: boolean; data: Uint8Array };
    const accountMap = new Map<Address, Account>(Object.entries(fx.accounts).filter(([, value]) => value !== null).map(([address, value]) => {
      const a = value as { owner: Address; executable: boolean; data: string };
      return [address as Address, { owner: a.owner, executable: a.executable, data: Uint8Array.from(Buffer.from(generationHeaders[address] ?? a.data, "base64")) }];
    }));
    const info = (key: { toString(): string }) => {
      const a = accountMap.get(key.toString() as Address);
      return a ? { ...a, owner: new PublicKey(a.owner), data: Buffer.from(a.data), lamports: 1, rentEpoch: 0 } : null;
    };
    const context = { slot: fx.slot };
    const connection = { getAccountInfo: async (k: import("@solana/web3.js").PublicKey) => info(k), getAccountInfoAndContext: async (k: import("@solana/web3.js").PublicKey) => ({ context, value: info(k) }),
      getMultipleAccountsInfo: async (ks: import("@solana/web3.js").PublicKey[]) => ks.map(info), getMultipleAccountsInfoAndContext: async (ks: import("@solana/web3.js").PublicKey[]) => ({ context, value: ks.map(info) }), getSlot: async () => fx.slot };
    const build = createMimirRefreshGroupBuilder({ connection: connection as never, payer: fx.payer, commitment: "confirmed",
      profile: { cluster: "localnet", name: "localnet" as never, programId: new PublicKey(fx.programId) } });
    const built = await build(fx.target);
    const group = { ...built, abi1Recipes: undefined, abi1ConverterSourceCount: undefined, updates: built.updates.map((u) => ({ ...u, abi1: undefined })),
      publish: { ...built.publish, abi1: undefined } };
    const ix = group.publish.instructions[0]!; const classic = ix.data[0] === 89;
    const execution = ix.accounts[classic ? 2 : 8]!.address;
    const state = classic ? decodeMimirClassicExecution(accountMap.get(execution)!.data) : decodeMimirCompositeExecution(accountMap.get(execution)!.data);
    const recipes = state.layout.descriptors; const n = state.componentCount; const s = state.converterSourceCount;
    if (name === "classic-clmm-native-sparse.json") {
      for (const meta of ix.accounts.slice(3 + recipes[0]!.bindingWidth, 3 + recipes[0]!.bindingWidth + 3))
        if (!accountMap.has(meta.address)) accountMap.set(meta.address, { owner: "11111111111111111111111111111111" as Address,
          executable: false, data: new Uint8Array() });
    }
    const cell = { ...manifest.bank.cells[1]!, id: name, executionKind: classic ? "classic" as const : "composite" as const,
      recipe: mimirRecipeTupleKey(recipes[0]!), sourceCount: n + s, primarySourceCount: n, converterSourceCount: s, converter: s > 0,
      recipeTupleKeys: recipes.map(mimirRecipeTupleKey) };
    const { mimirFusedRecipeBindingVariant } = await import("../src/beta/compositeExecution.js");
    const caps = [...new Map(recipes.map((r) => [mimirRecipeTupleKey(r), { ...r,
      bindingVariant: mimirFusedRecipeBindingVariant(r),
      clusterEnabled: true, exactElfCells: { publish: [name] } }])).values()];
    const policy = { ...capability, cells: new Map([[name, cell]]), manifest: { ...manifest, programId: fx.programId as Address, recipes: caps, bank: { ...manifest.bank, cells: [cell] } } };
    let builds = 0; let sims = 0; const reads: Address[] = [];
    const args = { programId: fx.programId as Address, payer: fx.payer as Address, cluster: "localnet" as "localnet" | "devnet" | "mainnet-beta", target: fx.target,
      buildRefreshGroup: async () => { builds++; return group; }, recentBlockhash: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9n },
      readAccount: async (address: Address) => { reads.push(address); return accountMap.get(address) ?? null; },
      simulate: async () => { sims++; return { err: null, unitsConsumed: 82_258n }; } };
    const published = await prepareMimirStandalonePublication(args);
    assert.deepEqual([builds, sims, published.unitsConsumed], [1, 1, 82_258n], name);
    assert.deepEqual(published.transaction.instructions, group.publish.instructions, name);
    assert.ok(reads.includes(execution), name);
    const events: string[] = []; let wire = ""; const lazyHash = "SysvarC1ock11111111111111111111111111111111";
    const lazy = await prepareMimirStandalonePublication({ ...args,
      buildRefreshGroup: async () => { await new Promise((r) => setTimeout(r, 1)); events.push("group"); return group; },
      readAccount: async (address: Address) => { await new Promise((r) => setTimeout(r, 1)); events.push("read"); return accountMap.get(address) ?? null; },
      recentBlockhash: async () => { events.push("blockhash"); return { blockhash: lazyHash, lastValidBlockHeight: 11n }; },
      simulate: async (w: string) => { events.push("simulate"); wire = w; return { err: null }; } });
    assert.deepEqual([events.filter((e) => e === "blockhash").length, events.slice(-2), events[0]], [1, ["blockhash", "simulate"], "group"], name);
    assert.ok(events.includes("read"), name);
    let inflight = 0, peak = 0;
    await prepareMimirStandalonePublication({ ...args, readAccount: async (address: Address) => {
      peak = Math.max(peak, ++inflight); await new Promise((r) => setTimeout(r, 1)); inflight--; return accountMap.get(address) ?? null; } });
    assert.ok(peak > 1, name + ": authentication reads start together");
    const floors: (bigint | undefined)[] = [];
    const readAccounts = async (addresses: readonly Address[], floor: bigint | undefined) => {
      floors.push(floor); return { slot: 12n, value: addresses.map((a) => accountMap.get(a) ?? null) }; };
    const coherent = await prepareMimirStandalonePublication({ ...args, readAccount: undefined, readAccounts, minContextSlot: 10n });
    assert.deepEqual(coherent.transaction.instructions, group.publish.instructions, name);
    assert.ok(floors[0] === 10n && floors.every((floor) => floor !== undefined && floor >= 10n), name + ": cohort reads at or above the reuse floor");
    const seededFloors: (bigint | undefined)[] = [];
    const seeded = await prepareMimirStandalonePublication({ ...args, buildRefreshGroup: async () => built, readAccount: undefined, minContextSlot: 10n,
      readAccounts: async (addresses: readonly Address[], floor: bigint | undefined) => (seededFloors.push(floor), readAccounts(addresses, floor)) });
    assert.deepEqual(seeded.transaction.instructions, built.publish.instructions, name);
    assert.deepEqual(seededFloors, [10n], name + ": hinted recipes authenticate from one seeded cohort at the reuse floor");
    assert.deepEqual([lazy.transaction.recentBlockhash, lazy.transaction.lastValidBlockHeight, wire], [lazyHash, 11n, Buffer.from(lazy.transaction.serializedTransaction).toString("base64")], name);
    for (const [err, kind] of [["BlockhashNotFound", "BlockhashNotFound"], [{ InstructionError: [0, { Custom: 1 }] }, "InstructionError"]] as const)
      await assert.rejects(prepareMimirStandalonePublication({ ...args, simulate: async () => ({ err }) }),
        (e: MimirBetaSimulationError) => e instanceof MimirBetaSimulationError && e.code === "SIMULATION_FAILED" && e.errorKind === kind);
    const drift: unknown[] = []; const classify = async (err: unknown, logs: unknown): Promise<never> => { drift.push([err, logs]); throw new Error(`drift:${JSON.stringify(err)}`); };
    await assert.rejects(prepareMimirStandalonePublication({ ...args, buildRefreshGroup: async () => ({ ...group, preparationDrift: classify }),
      simulate: async () => ({ err: { InstructionError: [0, { Custom: 46 }] }, logs: ["l"] }) }), /drift:/);
    assert.deepEqual(drift, [[{ InstructionError: [0, { Custom: 46 }] }, ["l"]]], name + ": normal tag-87 simulation goes through the moved-window proof");
    assert.equal((await prepareMimirStandalonePublication({ ...args, buildRefreshGroup: async () => ({ ...group, preparationDrift: classify }) })).preparationDrift, classify, name);
    const refuse = async (over: object, pattern = /ABI|Invalid|ACCOUNT|Stale|NotReady/) => {
      const before = sims; await throwsCode(prepareMimirStandalonePublication({ ...args, ...over }), pattern); assert.equal(sims, before, name);
    };
    await refuse({ readAccount: undefined, readAccounts, minContextSlot: 13n }, /context regressed/);
    const moved = (a: Address) => { const live = accountMap.get(a)!; return { ...live, data: Uint8Array.from(live.data, (b, i) => i === live.data.length - 1 ? b ^ 1 : b) }; };
    await refuse({ readAccount: undefined, readAccounts: async (addresses: readonly Address[]) => ({ slot: 12n,
      value: addresses.map((a) => addresses.length > 1 && a === execution ? moved(a) : accountMap.get(a) ?? null) }) }, /did not converge|ABI|Invalid|ACCOUNT/);
    for (const cluster of ["devnet", "mainnet-beta"])
      await refuse({ cluster, capability: policy, readAccount: undefined, recipes }, /trusted account reader/);
    await refuse({ releaseRecipeScope: true, capability: policy, readAccount: undefined, recipes }, /trusted account reader/);
    for (const patch of [null, { ...accountMap.get(execution)!, owner: key(999) }, { ...accountMap.get(execution)!, executable: true }])
      await refuse({ readAccount: async (address: Address) => address === execution ? patch : accountMap.get(address) ?? null });
    await refuse({ recipes: recipes.map((r, i) => i === 0 ? { ...r, minSlotGap: r.minSlotGap + 1 } : r), converterSourceCount: s }, /metadata differs/);
    await refuse({ recipes, converterSourceCount: s + 1 }, /row metadata/);
    await refuse({ buildRefreshGroup: async () => ({ ...group, publish: { ...group.publish,
      abi1: { recipes: recipes.map((r, i) => i === 0 ? { ...r, minSlotGap: r.minSlotGap + 1 } : r), converterSourceCount: s } } }) }, /metadata differs/);
    if (recipes.some((r) => r.mode === 4)) await refuse({ releaseRecipeScope: true, capability: policy }, /RELEASE_SCOPE_UNSUPPORTED/);
    const changedGroup = (changed: MimirBetaInstruction) => async () => ({ ...group, publish: { ...group.publish, instructions: [changed] } });
    const mutateMeta = (i: number, patch: object) => ({ ...ix, accounts: ix.accounts.map((m, j) => i === j ? { ...m, ...patch } : m) });
    await refuse({ buildRefreshGroup: changedGroup(mutateMeta(classic ? 2 : 8, { address: key(999) })) }, /execution PDA/);
    await refuse({ buildRefreshGroup: changedGroup(mutateMeta(classic ? 0 : 1, { address: key(999) })) });
    await refuse({ buildRefreshGroup: changedGroup(mutateMeta(classic ? 3 : 9, { address: key(999) })) }, /membership/);
    await refuse({ buildRefreshGroup: changedGroup(mutateMeta(classic ? 3 : 9, { isWritable: true })) }, /bytes\/metas/);
    await refuse({ buildRefreshGroup: changedGroup(mutateMeta(classic ? 3 : 9, { isSigner: true })) }, /bytes\/metas/);
    await refuse({ buildRefreshGroup: changedGroup({ ...ix, accounts: ix.accounts.slice(0, -1) }) }, /account or row count/);
    await refuse({ buildRefreshGroup: changedGroup({ ...ix, accounts: [...ix.accounts, ix.accounts[0]!] }) }, /account or row count/);
    const first = ix.accounts[classic ? 3 : 9]!.address;
    for (const patch of [{ owner: key(999) }, { executable: !accountMap.get(first)!.executable }])
      await refuse({ readAccount: async (address: Address) => address === first ? { ...accountMap.get(first)!, ...patch } : accountMap.get(address) ?? null }, /membership owner\/executable/);
    await refuse({ readAccount: async (address: Address) => address === first ? null : accountMap.get(address) ?? null }, /membership owner\/executable/);
    if (name === "classic-clmm-native-sparse.json") {
      const tickStart = 3 + recipes[0]!.bindingWidth;
      const ticks = ix.accounts.slice(tickStart, tickStart + 3).map((m) => m.address);
      const blank = { owner: "11111111111111111111111111111111" as Address, executable: false, data: new Uint8Array() };
      for (const sparse of [blank, null]) {
        const accepted = await prepareMimirStandalonePublication({ ...args,
          readAccount: async (a: Address) => ticks.includes(a) ? sparse : accountMap.get(a) ?? null });
        assert.deepEqual(accepted.transaction.instructions, group.publish.instructions);
        for (let k = 0; k < 3; k++) await refuse({ buildRefreshGroup: changedGroup(mutateMeta(tickStart + k, { address: key(999) })),
          readAccount: async (a: Address) => a === key(999) ? sparse : accountMap.get(a) ?? null }, /external tail identity/);
      }
      for (const address of ticks) {
        for (const patch of [{ ...blank, owner: key(999) }, { ...blank, data: Uint8Array.of(1) }, { ...blank, executable: true }])
          await refuse({ readAccount: async (a: Address) => a === address ? patch : accountMap.get(a) ?? null }, /external/);
      }
      const observation = ix.accounts[tickStart + 3]!.address;
      for (const sparse of [blank, null]) await refuse({
        readAccount: async (a: Address) => a === observation ? sparse : accountMap.get(a) ?? null }, /external|membership owner\/executable/);
      for (const meta of ix.accounts.slice(3, tickStart)) {
        for (const sparse of [blank, null]) await refuse({
          readAccount: async (a: Address) => a === meta.address ? sparse : accountMap.get(a) ?? null }, /membership/);
      }
    }
    const suffix = ix.accounts[(classic ? 3 : 9) + recipes[0]!.bindingWidth]?.address;
    if (recipes[0]!.bindingWidth < recipes[0]!.externalWidth) {
      await refuse({ readAccount: async (address: Address) => address === suffix
        ? { ...accountMap.get(address)!, executable: !accountMap.get(address)!.executable } : accountMap.get(address) ?? null }, /external executable role/);
    }
    let externalOffset = classic ? 3 : 9;
    for (const [rowIndex, recipe] of recipes.entries()) {
      for (let k = recipe.bindingWidth; k < recipe.externalWidth; k++) {
        const role = externalOffset + k; const address = ix.accounts[role]!.address; const original = accountMap.get(address)!;
        await refuse({ buildRefreshGroup: changedGroup(mutateMeta(role, { address: key(999) })),
          readAccount: async (a: Address) => a === key(999) ? original : accountMap.get(a) ?? null }, /external/);
        await refuse({ readAccount: async (a: Address) => a === address ? { ...original, owner: key(999) } : accountMap.get(a) ?? null }, /external/);
        if (k === recipe.externalWidth - 1 && original.data.length >= 45 && new DataView(original.data.buffer, original.data.byteOffset).getUint32(0, true) === 3) {
          const data = Uint8Array.from(original.data); data[4] ^= 1;
          await prepareMimirStandalonePublication({ ...args, readAccount: async (a: Address) => a === address ? { ...original, data } : accountMap.get(a) ?? null });
        }
      }
      if (recipe.adapterType === 4) {
        const { makeBetaCaptureFixture } = await import("./fixtures/betaCaptureFixtures.js");
        const capture = await makeBetaCaptureFixture("raydium-amm-v4");
        const sentinel = capture.fixtureAccounts.find((a) => a.fixtureRole === "open-orders")!;
        assert.equal(sentinel.address, "11111111111111111111111111111111"); assert.equal(sentinel.executable, true);
        const data = Uint8Array.from(accountMap.get(execution)!.data);
        const memberOffset = state.layout.membershipOffsets[rowIndex]! + 4 + 65 * 3;
        data.set(addressBytes(sentinel.address), memberOffset); data.set(addressBytes(sentinel.owner), memberOffset + 32); data[memberOffset + 64] = 1;
        const sentinelIx = mutateMeta(externalOffset + 3, { address: sentinel.address });
        const poolAddress = ix.accounts[externalOffset]!.address; const pool = accountMap.get(poolAddress)!;
        const poolData = Uint8Array.from(pool.data); const rule = capture.input.descriptor.planRule;
        assert.equal(rule.kind, "raydium-amm-v4");
        if (rule.kind === "raydium-amm-v4") poolData.fill(0, rule.openOrdersOffset, rule.openOrdersOffset + 32);
        const accepted = await prepareMimirStandalonePublication({ ...args, buildRefreshGroup: changedGroup(sentinelIx),
          readAccount: async (a: Address) => a === execution ? { ...accountMap.get(a)!, data } : a === sentinel.address ? sentinel : a === poolAddress ? { ...pool, data: poolData } : accountMap.get(a) ?? null });
        assert.deepEqual(accepted.transaction.instructions, [sentinelIx]);
      }
      externalOffset += recipe.externalWidth;
    }
    if (!classic) {
      await refuse({ payer: key(999) }, /bytes\/metas/);
      const blankData = Uint8Array.from(ix.data);
      const view = new DataView(blankData.buffer); view.setBigUint64(41, 0n, true); view.setBigUint64(49, 1n, true);
      const snapshot = ix.accounts[1]!.address;
      for (const blank of [null, { owner: "11111111111111111111111111111111" as Address, executable: false, data: new Uint8Array() }]) {
        const blankArgs = { ...args, buildRefreshGroup: changedGroup({ ...ix, data: blankData }),
          readAccount: async (address: Address) => address === snapshot ? blank : accountMap.get(address) ?? null };
        await prepareMimirStandalonePublication(blankArgs);
        if (recipes.some((r) => r.mode === 4)) {
          const sample = Uint8Array.from(blankData); new DataView(sample.buffer).setBigUint64(49, 0n, true);
          new DataView(sample.buffer).setBigUint64(98, 0n, true);
          await prepareMimirStandalonePublication({ ...blankArgs, buildRefreshGroup: changedGroup({ ...ix, data: sample }) });
        }
      }
    }
    const inactive = Uint8Array.from(accountMap.get(execution)!.data); inactive[classic ? 123 : 122] = 0;
    await refuse({ readAccount: async (address: Address) => address === execution ? { ...accountMap.get(execution)!, data: inactive } : accountMap.get(address) ?? null });
    if (!recipes.some((r) => r.mode === 4)) {
      const mainPolicy = { ...policy, manifest: { ...policy.manifest, clusterGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" } };
      const main = { ...args, cluster: "mainnet-beta" as const, capability: mainPolicy };
      await prepareMimirStandalonePublication(main);
      await refuse({ ...main, simulate: undefined }, /requires an exact-wire simulation/);
      for (const sim of [{ err: undefined }, { err: null }, { err: null, unitsConsumed: 0 }, { err: null, unitsConsumed: 1_400_001n },
        { err: null, unitsConsumed: 1.5 }, { err: { InstructionError: [0, "x"] }, unitsConsumed: 5 }])
        await throwsCode(prepareMimirStandalonePublication({ ...main, simulate: async () => sim }), /SIMULATION_FAILED|no valid compute units/);
      await throwsCode(prepareMimirStandalonePublication({ ...main, capability: undefined }), /capability/);
      await throwsCode(prepareMimirStandalonePublication({ ...main, capability: policy }), /canonical mainnet-beta genesis/);
      const { mimirExecutableGenerationPins } = await import("../src/internal/nativeMonoRefreshCore.js");
      const devnetPins = Object.values(mimirExecutableGenerationPins("devnet"));
      const hasOtherProgram = recipes.some((r) => r.adapterType === 4 || r.mode === 3 && r.adapterType === 2);
      if (hasOtherProgram) await refuse({ cluster: "devnet", capability: policy }, /external executable generation|external capture plan|external account missing/);
      else {
        const devnetRead = async (address: Address) => {
          const a = accountMap.get(address); const pin = devnetPins.find((p) => p[1] === address);
          if (!a || !pin) return a ?? null;
          const data = Uint8Array.from(a.data); new DataView(data.buffer).setBigUint64(4, pin[2], true);
          return { ...a, data };
        };
        await prepareMimirStandalonePublication({ ...args, cluster: "devnet", capability: policy, readAccount: devnetRead });
      }
      await throwsCode(prepareMimirStandalonePublication({ ...main,
        simulate: async () => ({ err: { InstructionError: [0, "x"] } }) }), /SIMULATION_FAILED/);
      const initOnly = { ...policy, manifest: { ...policy.manifest, recipes: policy.manifest.recipes.map((r) => ({ ...r, exactElfCells: { init: [name] } })) } };
      await refuse({ ...main, capability: { ...initOnly, manifest: { ...initOnly.manifest, clusterGenesisHash: mainPolicy.manifest.clusterGenesisHash } } }, /no measured/);
      if (classic) {
        const sample = Uint8Array.from(ix.data); const v = new DataView(sample.buffer); v.setBigUint64(43, v.getBigUint64(35, true), true);
        await refuse({ ...main, buildRefreshGroup: changedGroup({ ...ix, data: sample }) }, /no measured classic sample/);
      }
      const disabled = { ...policy, manifest: { ...policy.manifest, recipes: policy.manifest.recipes.map((r) => ({ ...r, clusterEnabled: false })) } };
      await refuse({ ...main, capability: { ...disabled, manifest: { ...disabled.manifest, clusterGenesisHash: mainPolicy.manifest.clusterGenesisHash } }, recipes }, /RELEASE_SCOPE_UNSUPPORTED/);
    }
    {
      const [prevAt, headAt] = classic ? [35, 104] : [41, 106];
      const floored = (dPrev: bigint, dHead: bigint) => {
        const data = Uint8Array.from(ix.data); const v = new DataView(data.buffer);
        v.setBigUint64(prevAt, v.getBigUint64(prevAt, true) + dPrev, true); v.setBigUint64(prevAt + 8, v.getBigUint64(prevAt + 8, true) + dPrev, true);
        v.setBigUint64(headAt, v.getBigUint64(headAt, true) + dHead, true);
        return { ...ix, data };
      };
      const view = new DataView(ix.data.buffer, ix.data.byteOffset); const prev = view.getBigUint64(prevAt, true); const head = view.getBigUint64(headAt, true);
      assert.equal(view.getBigUint64(prevAt + 8, true), prev + 1n, name + ": publish producer");
      for (const [dPrev, dHead] of [[prev ? -1n : 0n, head ? -1n : 0n], [prev ? -1n : 0n, 0n]] as const) {
        const lower = floored(dPrev, dHead);
        const accepted = await prepareMimirStandalonePublication({ ...args, buildRefreshGroup: changedGroup(lower) });
        assert.deepEqual(accepted.transaction.instructions, [lower], name + ": floors below the current state authenticate");
      }
      await refuse({ buildRefreshGroup: changedGroup(floored(1n, 0n)) }, /publish floor above current state/);
      await refuse({ buildRefreshGroup: changedGroup(floored(0n, 1n)) }, /publish floor above current state/);
    }
    cases.push({ args, group, accountMap, policy });
  }
  const [classicCase, , , compositeCase] = cases;
  const mixed = { ...compositeCase!.group, updates: [classicCase!.group.publish] };
  const mixedAccounts = new Map([...classicCase!.accountMap, ...compositeCase!.accountMap]);
  const mixedResult = await prepareMimirStandalonePublication({ ...compositeCase!.args, buildRefreshGroup: async () => mixed,
    readAccount: async (address: Address) => mixedAccounts.get(address) ?? null });
  assert.deepEqual(mixedResult.transaction.instructions.map((ix) => ix.data[0]), [89, 87]);
  const mixedCells = [...classicCase!.policy.cells.values(), ...compositeCase!.policy.cells.values()];
  const mixedRecipes = [...new Map([...classicCase!.policy.manifest.recipes, ...compositeCase!.policy.manifest.recipes]
    .map((r) => [mimirRecipeTupleKey(r), { ...r, exactElfCells: { publish: mixedCells.filter((c) => c.recipeTupleKeys.includes(mimirRecipeTupleKey(r))).map((c) => c.id) } }])).values()];
  const mixedPolicy = { ...compositeCase!.policy, cells: new Map(mixedCells.map((c) => [c.id, c])),
    manifest: { ...compositeCase!.policy.manifest, clusterGenesisHash: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d", recipes: mixedRecipes, bank: { ...manifest.bank, cells: mixedCells } } };
  await prepareMimirStandalonePublication({ ...compositeCase!.args, cluster: "mainnet-beta", capability: mixedPolicy,
    buildRefreshGroup: async () => mixed, readAccount: async (address: Address) => mixedAccounts.get(address) ?? null });
  await throwsCode(prepareMimirStandalonePublication({ ...compositeCase!.args, cluster: "mainnet-beta", capability: { ...compositeCase!.policy, manifest: { ...compositeCase!.policy.manifest, clusterGenesisHash: mixedPolicy.manifest.clusterGenesisHash } },
    buildRefreshGroup: async () => mixed, readAccount: async (address: Address) => mixedAccounts.get(address) ?? null }), /RELEASE_SCOPE_UNSUPPORTED|no measured/);
  await throwsCode(prepareMimirStandalonePublication({ ...classicCase!.args, buildRefreshGroup: async () => ({ ...classicCase!.group,
    publish: { ...classicCase!.group.publish, instructions: Array.from({ length: 70 }, () => classicCase!.group.publish.instructions[0]!) } }) }), /TRANSACTION_TOO_LARGE|exceeds/);
  await throwsCode(prepareMimirStandalonePublication({ ...classicCase!.args, buildRefreshGroup: async () => ({ ...classicCase!.group,
    publish: { ...classicCase!.group.publish, instructions: [{ ...classicCase!.group.publish.instructions[0]!, programAddress: key(999) }] } }) }), /another program/);
  const unknown = { ...mixed, updates: [], publish: { ...mixed.publish, instructions: [{ programAddress: PROGRAM, accounts: [], data: Uint8Array.of(255) }] } };
  await throwsCode(prepareMimirStandalonePublication({ ...compositeCase!.args, buildRefreshGroup: async () => unknown }), /tag 255/);
  const local = await prepareMimirStandalonePublication({ ...compositeCase!.args, buildRefreshGroup: async () => mixed, readAccount: undefined });
  assert.deepEqual(local.transaction.instructions.map((ix) => ix.data[0]), [89, 87]);
}
// G05 release recipe scope: the pinned V1 policy refuses every manifest m4 row on localnet with RELEASE_SCOPE_UNSUPPORTED; R01-R09 keep their own boundaries.
{
  const D = "3.0.m2.k0.E7.K3.b1.v0", A = "4.0.m4.k4.E8.K6.b1.v0", P0 = "6.0.m4.k4.E9.K7.b1.v0", P1 = "6.1.m4.k4.E9.K7.b1.v0";
  const rows: [string, "init" | "fresh-creation" | "sample" | "publish", "classic" | "composite", number, string[]][] = [
    ["R01", "publish", "classic", 5, ["2.0.m0.k0.E4.K4.b1.v0", ...Array(5).fill("1.0.m2.k0.E8.K4.b1.v1")]],
    ["R02", "init", "composite", 1, ["0.0.m0.k0.E7.K4.b1.v1", "1.1.m0.k0.E8.K5.b1.v1", "2.0.m6.k0.E4.K4.b1.v0", "3.0.m0.k0.E6.K3.b1.v1", "7.0.m0.k0.E3.K3.b1.v0", D]],
    ...["2.0.m2.k0.E5.K4.b1.v0", "1.0.m2.k0.E8.K4.b1.v1", "1.1.m2.k0.E9.K5.b1.v1", D, "3.0.m2.k0.E9.K3.b1.v1", "3.1.m2.k0.E8.K4.b1.v0", "3.1.m2.k0.E10.K4.b1.v1"]
      .map((t, i) => [`R0${i + 3}`, "sample", "classic", 0, [t]] as typeof rows[number]),
    ...[A, P0, P1].flatMap((t, i) => (["fresh-creation", "sample", "publish"] as const).map((a, j) => [`R${10 + 3 * i + j}`, a, "classic", 0, [t]] as typeof rows[number])),
    ...(["fresh-creation", "init", "publish", "sample"] as const).map((a, j) => [`R${19 + j}`, a, "composite", 0, [D, A]] as typeof rows[number]),
    ...(["fresh-creation", "init", "publish", "sample"] as const).map((a, j) => [`R${23 + j}`, a, "composite", 1, [D, A, P1, D]] as typeof rows[number])];
  const recipe = (t: string) => { const [adapterType, adapterVersion, mode, temporalKind, externalWidth, bindingWidth, accountsBindingVersion] =
    t.split(".").map((x) => Number(x.replace(/^[a-zA-Z]+/, ""))); return { adapterType, adapterVersion, mode, temporalKind, externalWidth, bindingWidth, accountsBindingVersion } as MimirFusedRecipe; };
  const admitted = [...new Set(rows.flatMap((r) => r[4]).filter((t) => !t.includes(".m4.")))].map((t) => ({ ...recipe(t), bindingVariant: Number(t.at(-1)) as 0 | 1,
    clusterEnabled: true, exactElfCells: {} }));
  const policy = { manifest: { ...manifest, recipes: [...admitted, { ...recipe(A), bindingVariant: 0 as const, clusterEnabled: false, exactElfCells: {} }] }, manifestSha256: "", cells: new Map() };
  const gate = (r: typeof rows[number], over: object = {}) => assertMimirAbi1Capable({ cluster: "localnet", programId: PROGRAM, capability: policy,
    recipes: r[4].map(recipe), action: r[1], executionKind: r[2], converterSourceCount: r[3], releaseRecipeScope: true, ...over });
  assert.equal(rows.length, 26);
  for (const r of rows) {
    const [id, , , , tuples] = r;
    assert.deepEqual(r[4].map((t) => mimirRecipeTupleKey(recipe(t))), tuples, id);
    if (tuples.some((t) => t.includes(".m4."))) {
      assert.throws(() => gate(r), /RELEASE_SCOPE_UNSUPPORTED/, id);
      assert.throws(() => gate(r, { cluster: "mainnet-beta" }), /RELEASE_SCOPE_UNSUPPORTED/, `${id} scope precedes the ABI checker`);
      assert.doesNotThrow(() => gate(r, { releaseRecipeScope: undefined }), `${id} option absent: localnet stays open`);
    } else assert.doesNotThrow(() => gate(r), `${id} admitted rows keep their packet/program boundary`);
    assert.throws(() => gate(r, { capability: undefined }), /RELEASE_SCOPE_UNSUPPORTED/, `${id} missing policy fails closed`);
  }
  let built = 0; let simulated = 0;
  const groupM4 = { updates: [], publish: { instructions: [{ programAddress: PROGRAM, accounts: [], data: encodeMimirFusedClassicData({ feedId: new Uint8Array(32).fill(7),
    declaredMaxSnapshotAge: 30, previousSnapshotRevision: 1n, nextSnapshotRevision: 1n, componentCount: 1, sourceSetRevision: 1n, planHash: new Uint8Array(32).fill(3),
    converterSourceCount: 0, feedConfigRevision: 1n, ringNewestSlots: [0n] }) }],
    abi1: { recipes: [recipe(A)], converterSourceCount: 0 } }, check: {} } as never;
  const standalone = { programId: PROGRAM, payer: roles.payer, cluster: "localnet" as const, target: { kind: "composite", compositeConfig: roles.cfc } as const,
    buildRefreshGroup: async () => { built += 1; return groupM4; }, recentBlockhash: { blockhash: "11111111111111111111111111111111", lastValidBlockHeight: 9n },
    capability: policy, releaseRecipeScope: true, simulate: async () => { simulated += 1; return { err: null }; } };
  await throwsCode(prepareMimirStandalonePublication(standalone), /trusted account reader/);
  assert.deepEqual([built, simulated], [1, 0]);
  assert.equal((await prepareMimirStandalonePublication({ ...standalone, releaseRecipeScope: undefined })).unitsConsumed, null);
}
// D0: recognized ComputeBudget directives become TxV1 config before hashing/caps; exact key/instruction/byte delta.
{
  const { compileMimirBetaTransactionV1 } = await import("../src/beta/transactionV1.js");
  const CB = "ComputeBudget111111111111111111111111111111" as Address;
  const body = { programAddress: PROGRAM, accounts: [{ address: roles.payer, isSigner: true, isWritable: true }], data: Uint8Array.of(1) };
  const compile = (instructions: MimirBetaInstruction[], priorityFeeLamports?: bigint) => compileMimirBetaTransactionV1({ feePayer: roles.payer,
    recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions, ...(priorityFeeLamports !== undefined ? { priorityFeeLamports } : {}) });
  const limit = { programAddress: CB, accounts: [], data: Uint8Array.of(2, 0xc0, 0x5c, 0x15, 0) }; // 1,400,000
  const price = { programAddress: CB, accounts: [], data: Uint8Array.of(3, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0) }; // 1,000,000 µlamports/CU
  const hoisted = await compile([limit, price, body]);
  const explicit = await compile([body], 1_400_000n);
  assert.deepEqual(hoisted.serializedMessage, explicit.serializedMessage, "directives equal the explicit TxV1 config");
  assert.deepEqual([hoisted.packet.accountCount, hoisted.packet.instructionCount, hoisted.config.priorityFeeLamports], [2, 1, 1_400_000n]);
  const plain = await compile([body]);
  assert.deepEqual([plain.packet.accountCount, plain.packet.serializedTransactionBytes], [hoisted.packet.accountCount, hoisted.packet.serializedTransactionBytes]);
  // Non-maximum round trips for opcodes 1-4: each directive lands in the TxV1 config, the price is charged on the translated limit.
  const u32 = (op: number, v: number) => { const d = new Uint8Array(5); d[0] = op; new DataView(d.buffer).setUint32(1, v, true); return { programAddress: CB, accounts: [], data: d }; };
  const lowered = await compile([u32(1, 65_536), u32(2, 200_000), price, u32(4, 1_048_576), body]);
  assert.deepEqual(lowered.config, { computeUnitLimit: 200_000, loadedAccountsDataSizeLimit: 1_048_576, heapSize: 65_536, priorityFeeLamports: 200_000n });
  const { getCompiledTransactionMessageDecoder } = await import("@solana/transaction-messages");
  const decoded = getCompiledTransactionMessageDecoder().decode(lowered.serializedMessage) as unknown as { configMask: number; configValues: { value: unknown }[] };
  assert.deepEqual([decoded.configMask, decoded.configValues.map((v) => v.value)], [31, [200_000n, 200_000, 1_048_576, 65_536]]);
  assert.equal(lowered.packet.instructionCount, 1);
  const { isMimirBetaTransactionV1ConfigEnvelope } = await import("../src/beta/transactionV1.js");
  assert.ok(isMimirBetaTransactionV1ConfigEnvelope(decoded as never));
  for (const [ix, cfg] of [[u32(1, 32_768), { heapSize: 32_768 }], [u32(2, 1), { computeUnitLimit: 1 }], [u32(4, 4_096), { loadedAccountsDataSizeLimit: 4_096 }]] as const) {
    assert.deepEqual((await compile([ix, body])).config, { ...{ computeUnitLimit: 1_400_000, loadedAccountsDataSizeLimit: 67_108_864 }, ...cfg,
      priorityFeeLamports: (BigInt(("computeUnitLimit" in cfg ? cfg.computeUnitLimit : 1_400_000)) * 10_000n + 999_999n) / 1_000_000n });
  }
  // Runtime semantics: limits clamp to the maxima; duplicates, bad heap frames and a zero loaded-data limit are errors.
  assert.equal((await compile([u32(2, 1_400_001), body])).config.computeUnitLimit, 1_400_000);
  assert.equal((await compile([u32(4, 67_108_865), body])).config.loadedAccountsDataSizeLimit, 67_108_864);
  await throwsCode(compile([u32(2, 1), u32(2, 2), body]), /duplicate/);
  for (const bad of [u32(1, 32_767), u32(1, 33_000), u32(1, 263_168), u32(4, 0)]) await throwsCode(compile([bad, body]), /invalid ComputeBudget/);
  await throwsCode(compile([{ programAddress: CB, accounts: [], data: Uint8Array.of(0, 0, 0, 1, 0) }, body]), /unrecognized ComputeBudget/);
  await throwsCode(compile([{ ...price, accounts: [{ address: roles.payer, isSigner: false, isWritable: false }] }, body]), /carries accounts/);
  await throwsCode(compile([limit]), /no instructions/);
}
console.log("abi1Release ok");
