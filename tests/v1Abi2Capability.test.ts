import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getProgramDerivedAddress, type Address } from "@solana/kit";
import {
  MIMIR_V1_ABI, MIMIR_V1_CAPABILITY_MANIFEST_SCHEMA, MIMIR_V1_CAPABILITY_TAGS, MIMIR_V1_LIMITS, MIMIR_V1_REMOVED_TAGS, MIMIR_V1_STATE, MIMIR_V1_TAG,
  assertMimirV1BankGates, observeMimirV1Deployment, verifyMimirAbi2Capability, type MimirV1CapabilityManifest,
} from "../src/v1/index.js";
import { MIMIR_CAPABILITY_MANIFEST_SCHEMA, mimirRecipeTupleKey, mimirSortedJsonSha256, verifyMimirAbi1Capability, type MimirCapabilityManifestV1 } from "../src/beta/abi1Release.js";
import { addressBytes, bytesAddress, hex, sha256 } from "../src/beta/bytes.js";

const key = (n: number) => bytesAddress(Uint8Array.from({ length: 32 }, (_, i) => (i === 0 ? n : 9)));
const LOADER = "BPFLoaderUpgradeab1e11111111111111111111111" as Address;
const PROGRAM = key(1); const [PROGRAM_DATA] = await getProgramDerivedAddress({ programAddress: LOADER, seeds: [addressBytes(PROGRAM)] }); const GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const elf = Uint8Array.from({ length: 100 }, (_, i) => i + 1);
const elfSha = hex(await sha256(elf));
const programAccount = new Uint8Array(36); new DataView(programAccount.buffer).setUint32(0, 2, true); programAccount.set(addressBytes(PROGRAM_DATA), 4);
const programData = new Uint8Array(45 + elf.length + 8); const pdView = new DataView(programData.buffer);
pdView.setUint32(0, 3, true); pdView.setBigUint64(4, 777n, true); programData.set(elf, 45);
const accounts = new Map<Address, { owner: Address; executable: boolean; data: Uint8Array }>([
  [PROGRAM, { owner: LOADER, executable: true, data: programAccount }], [PROGRAM_DATA, { owner: LOADER, executable: false, data: programData }]]);
const readAccount = async (address: Address) => accounts.get(address) ?? null;
const observed = await observeMimirV1Deployment({ programId: PROGRAM, elfLength: elf.length, clusterGenesisHash: GENESIS, readAccount });
assert.deepEqual(observed, { clusterGenesisHash: GENESIS, programId: PROGRAM, programDataAddress: PROGRAM_DATA, deploymentSlot: 777, elfSha256: elfSha });
await assert.rejects(observeMimirV1Deployment({ programId: PROGRAM, elfLength: elf.length - 1, clusterGenesisHash: GENESIS, readAccount }), /ELF length/);

// The V1 observer authenticates both accounts: loader owner, executable flags, canonical ProgramData.
const observeWith = (address: Address, patch: object, programId = PROGRAM) => observeMimirV1Deployment({ programId, elfLength: elf.length,
  clusterGenesisHash: GENESIS, readAccount: async (a) => a === address ? { ...accounts.get(a)!, ...patch } : readAccount(a) });
const identity = (what: string) => (e: Error) => e.message === `PROGRAM_ABI_MISMATCH:ABI-2 capability mismatch: ${what} account identity`;
await assert.rejects(observeWith(PROGRAM, { owner: key(3) }), identity("program"));
await assert.rejects(observeWith(PROGRAM_DATA, { owner: key(3) }), identity("ProgramData"));
await assert.rejects(observeWith(PROGRAM, { executable: false }), identity("program"));
await assert.rejects(observeWith(PROGRAM_DATA, { executable: true }), identity("ProgramData"));
const foreignProgram = new Uint8Array(programAccount); foreignProgram.set(addressBytes(key(2)), 4);
accounts.set(key(2), accounts.get(PROGRAM_DATA)!);
await assert.rejects(observeWith(PROGRAM, { data: foreignProgram }), identity("ProgramData"));

// The manifest generator refuses a bank report whose mandatory gates are missing, failing or regressed; accepted exceptions pass.
const gate = { pass: true, regressions: [] };
const gates = { t1: gate, cu: { ...gate, accepted_increases: ["CU-1"] }, tsub: gate, ref05_no_abort: gate };
assertMimirV1BankGates({ gates });
for (const [name, patch] of [["t1", { t1: { ...gate, pass: false } }], ["cu", { cu: { pass: true, regressions: ["x"] } }],
  ["tsub", { tsub: undefined }], ["ref05_no_abort", { ref05_no_abort: { pass: true } }]] as const) {
  assert.throws(() => assertMimirV1BankGates({ gates: { ...gates, ...patch } }), (e: Error) => e.message === `PROGRAM_ABI_MISMATCH:ABI-2 capability mismatch: bank gate ${name}`);
}

const damm = { adapterType: 7, adapterVersion: 0, mode: 0, temporalKind: 0, externalWidth: 3, bindingWidth: 3, accountsBindingVersion: 3 };
const clmm = { adapterType: 1, adapterVersion: 0, mode: 2, temporalKind: 0, externalWidth: 8, bindingWidth: 4, accountsBindingVersion: 3 };
const tuple = mimirRecipeTupleKey(damm as never);
const h = (c: string) => c.repeat(64);
const manifest: MimirV1CapabilityManifest = {
  schema: MIMIR_V1_CAPABILITY_MANIFEST_SCHEMA, abi: MIMIR_V1_ABI, clusterGenesisHash: GENESIS, programId: PROGRAM, programDataAddress: PROGRAM_DATA,
  deploymentSlot: 777, sourceCommit: "d89aa1b", elfSha256: elfSha, elfLength: elf.length, sdkVersion: "0.5.0-v1.12", sdkTarballSha256: h("0"),
  appCommit: "a", indexerCommit: "b", tags: MIMIR_V1_CAPABILITY_TAGS, removedTags: MIMIR_V1_REMOVED_TAGS, state: MIMIR_V1_STATE, limits: MIMIR_V1_LIMITS,
  recipes: [{ ...damm, bindingVariant: 0, clusterEnabled: true, exactElfCells: { publish: ["damm-publish"] } }],
  consumerBudgets: [{ schema: "mimir-consumer-budget-a2-v1", sha256: h("4") }],
  bank: { runnerSha256: h("5"), candidateElfSha256: elfSha, cells: [{ id: "damm-publish", fixtureSha256: h("1"), action: "publish", recipe: tuple,
    sourceCount: 1, converter: false, keys: 6, bytes: 500, instructions: 1, signers: 1, freeKeys: 58, cuBefore: null, cuAfter: 42_000,
    outputSha256: h("2"), status: "measured", executionKind: "classic", primarySourceCount: 1, converterSourceCount: 0, recipeTupleKeys: [tuple],
    instructionsSha256: h("3") }] },
  frameGate: { toolchain: "cargo-build-sbf", passed: true, logSha256: h("6") },
  review: { codexReviewReportSha256: h("7"), ponytailReportSha256: h("8") },
};
const verify = async (m: MimirV1CapabilityManifest, extra: Partial<Parameters<typeof verifyMimirAbi2Capability>[0]> = {}) =>
  verifyMimirAbi2Capability({ manifest: m, expectedManifestSha256: await mimirSortedJsonSha256(m), observed, ...extra });
const fails = async (p: Promise<unknown>, what: string) =>
  assert.rejects(p, (e: Error) => e.message === `PROGRAM_ABI_MISMATCH:ABI-2 capability mismatch: ${what}` && (e as Error & { code?: string }).code === "PROGRAM_ABI_MISMATCH");

// The V1 manifest passes, with its cell, recipe and consumer contract.
const capability = await verify(manifest, { consumerContractSha256: h("4"), recipes: [damm as never], packet: { action: "publish", executionKind: "classic", converterSourceCount: 0 } });
assert.equal(capability.manifestSha256, await mimirSortedJsonSha256(manifest));
assert.equal(capability.cells.get("damm-publish")?.cuAfter, 42_000);
assert.deepEqual(MIMIR_V1_CAPABILITY_TAGS, MIMIR_V1_TAG);
assert.deepEqual(MIMIR_V1_REMOVED_TAGS, [59, 60, 65, 66, 67, 68, 69, 70, 71, 72, 77, 82, 83, 88, 90, 97, 98, 99, 100, 101, 102]);
assert.deepEqual([MIMIR_V1_STATE.classic.rowsOffset, MIMIR_V1_STATE.classic.prefixLength, MIMIR_V1_STATE.composite.prefixFixed,
  MIMIR_V1_STATE.composite.prefixPerComponent, MIMIR_V1_STATE.classic.rowLength, MIMIR_V1_STATE.classic.converterFixedLength], [1_558, 512, 320, 80, 944, 1_797]);

// Every mismatch fails closed.
await fails(verifyMimirAbi2Capability({ manifest, expectedManifestSha256: h("f"), observed }), "manifest hash");
for (const [what, patch] of [
  ["schema", { schema: MIMIR_CAPABILITY_MANIFEST_SCHEMA }], ["schema", { abi: "ABI-1+A2" }],
  ["tags", { tags: { ...MIMIR_V1_TAG, REFRESH_FUSED_CLASSIC: 90 } }], ["tags", { removedTags: MIMIR_V1_REMOVED_TAGS.filter((t) => t !== 88) }],
  ["state/limits", { state: { ...MIMIR_V1_STATE, classic: { ...MIMIR_V1_STATE.classic, rowsOffset: 1_573 } } }],
  ["state/limits", { limits: { ...MIMIR_V1_LIMITS, staticKeys: 65 } }],
  ["deployment/ELF", { elfSha256: h("e") }], ["deployment/ELF", { deploymentSlot: 778 }], ["deployment/ELF", { programDataAddress: key(4) }],
  ["deployment/ELF", { bank: { ...manifest.bank, candidateElfSha256: h("e") } }],
  ["frame gate", { frameGate: { ...manifest.frameGate, passed: false } }],
  ["duplicate cell id", { bank: { ...manifest.bank, cells: [...manifest.bank.cells, { ...manifest.bank.cells[0]!, cuAfter: 1 }] } }],
  ["referenced cell evidence", { bank: { ...manifest.bank, cells: [{ ...manifest.bank.cells[0]!, status: "model" }] } }],
] as const) await fails(verify({ ...manifest, ...patch } as MimirV1CapabilityManifest), what);
await fails(verify(manifest, { observed: { ...observed, elfSha256: h("e") } }), "deployment/ELF");
await fails(verify(manifest, { consumerContractSha256: h("9") }), "consumer budget contract hash");
await assert.rejects(verify(manifest, { recipes: [clmm as never], packet: { action: "publish", executionKind: "classic", converterSourceCount: 0 } }),
  /RELEASE_SCOPE_UNSUPPORTED:recipe 1\.0\.m2\.k0\.E8\.K4\.b3\.v1 is outside the pinned release recipe scope/);
await fails(verify(manifest, { recipes: [damm as never], packet: { action: "sample", executionKind: "classic", converterSourceCount: 0 } }),
  "recipe 7/0/mode0/E3 has no measured classic sample primary cell");

// ABI-1 and ABI-2 manifests do not cross.
await assert.rejects(verifyMimirAbi1Capability({ manifest: manifest as unknown as MimirCapabilityManifestV1,
  expectedManifestSha256: await mimirSortedJsonSha256(manifest), observed }), /ABI-1 capability mismatch: schema/);

// The pinned manifest of the previous mainnet program still lists the feed-closing tags 97-102, so this SDK refuses it.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/v1/${name}`, import.meta.url), "utf8");
const draft = JSON.parse(fixture("abi2-mainnet-draft-manifest.json")) as MimirV1CapabilityManifest;
await fails(verifyMimirAbi2Capability({ manifest: draft, expectedManifestSha256: fixture("abi2-mainnet-draft-manifest.sha256").trim(),
  observed: JSON.parse(fixture("abi2-mainnet-draft-observation.json")) }), "tags");

console.log("v1Abi2Capability ok");
