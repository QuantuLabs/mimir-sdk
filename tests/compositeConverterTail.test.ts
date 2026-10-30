import assert from "node:assert/strict";
import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import * as C from "../src/consumer.js";
import * as P from "../src/pda.js";
import * as K from "../src/constants.js";
import { buildMimirFusedCompositeRefreshInstruction, buildMimirInitFusedClosure, buildMimirInitFusedCompositeClosure, deriveMimirFusedRecipe, mimirCompositeExecutionLayout } from "../src/beta/compositeExecution.js";
import type { MimirBetaInstruction } from "../src/beta/types.js";
import { assertMimirClassicConverterAdmitted } from "../src/beta/classicExecution.js";

const pk = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const a = (k: PublicKey) => k.toBase58() as Address;
const feed = Buffer.alloc(32, 31);
const program = new PublicKey(K.MIMIR_MAINNET_PROGRAM_ID.toBytes());
const [registry] = P.findOracleRegistryPda(0, program), [adminConfig] = P.findAdminConfigPda(1, program);
const [snapshot] = P.findCompositeSnapshotPda(feed, program), [configAddress] = P.findCompositeFeedConfigPda(feed, program);
const [feeVault] = P.findFeedFeeVaultPda(feed, program);
const [execution] = PublicKey.findProgramAddressSync([Buffer.from("composite_execution"), feed], program);
const cpmm = deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 4, minSlotGap: 1, accountsBindingVersion: 1 });
const conv = deriveMimirFusedRecipe({ role: "converter", adapterType: 3, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion: 1 });
const ext = (start: number, n: number) => Array.from({ length: n }, (_, i) => a(pk(start + i)));
const web3 = (ix: MimirBetaInstruction) => new TransactionInstruction({ programId: new PublicKey(ix.programAddress), data: Buffer.from(ix.data),
  keys: ix.accounts.map((m) => ({ pubkey: new PublicKey(m.address), isSigner: m.isSigner, isWritable: m.isWritable })) });
const tag87 = (converter: boolean) => web3(buildMimirFusedCompositeRefreshInstruction({ programId: a(program), payer: a(pk(42)), compositeSnapshot: a(snapshot),
  compositeConfig: a(configAddress), registry: a(registry), adminConfig: a(adminConfig), feeVault: a(feeVault), treasury: a(pk(51)), execution: a(execution),
  layout: mimirCompositeExecutionLayout([cpmm, cpmm], converter ? [conv] : []), componentExternals: [ext(100, 4), ext(110, 4)],
  converterExternals: converter ? [ext(120, 7)] : [], request: { compositeFeedId: feed, expectedConfigRevision: 1n, previousSnapshotRevision: 0n,
    nextSnapshotRevision: 1n, componentSourceConfigRevisions: [1n, 1n], maxRefreshFeeLamports: 1_000n, componentRingNewestSlots: [0n, 0n],
    converterRingNewestSlots: converter ? [0n] : [] } }));
const consumer = new TransactionInstruction({ programId: pk(59), data: Buffer.from([1]), keys: [
  { pubkey: snapshot, isSigner: false, isWritable: false }, { pubkey: configAddress, isSigner: false, isWritable: false }] });
const read = (preReadInstructions: TransactionInstruction[]) => C.createMimirCompositeRefreshReadConsumerInstructions({
  compositeSnapshot: snapshot, compositeConfig: configAddress, consumerInstruction: consumer, preReadInstructions, programId: program });
const copyIx = (ix: TransactionInstruction, keys = ix.keys, data = ix.data) => new TransactionInstruction({ programId: ix.programId, keys, data });
const flip = (ix: TransactionInstruction, index: number, flag: "isSigner" | "isWritable") =>
  copyIx(ix, ix.keys.map((m, n) => (n === index ? { ...m, [flag]: !m[flag] } : { ...m })));
const bad = (label: string, ixs: TransactionInstruction[]) => assert.throws(() => read(ixs), /InvalidMimirAtomicRefreshInstruction/, label);

// Exactly one tag-87 producer, with or without the shared converter, is the composite pre-read.
assert.deepEqual(read([tag87(false)]).map((ix) => ix.data[0]), [87, 1]);
assert.deepEqual(read([tag87(true)]).map((ix) => ix.data[0]), [87, 1]);
assert.throws(() => read([]), /MissingMimirAtomicRefreshInstruction/);
// Removed tag 65 bytes and any wrong role/privilege reject.
bad("tag 65 prefix", [copyIx(tag87(false), undefined, Buffer.from([65, ...tag87(false).data.subarray(1)]))]);
bad("trailing byte", [copyIx(tag87(false), undefined, Buffer.concat([tag87(false).data, Buffer.from([0])]))]);
bad("component count", [copyIx(tag87(false), undefined, Buffer.from(tag87(false).data.map((b, i) => (i === 57 ? 6 : b))))]);
for (const index of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) bad(`privilege ${index}`, [flip(tag87(false), index, "isWritable")]);
bad("signer", [flip(tag87(false), 1, "isSigner")]);
bad("wrong execution", [copyIx(tag87(false), tag87(false).keys.map((m, n) => (n === 8 ? { ...m, pubkey: pk(77) } : m)))]);
bad("wrong fee vault", [copyIx(tag87(false), tag87(false).keys.map((m, n) => (n === 5 ? { ...m, pubkey: pk(77) } : m)))]);
bad("tag87 not last", [tag87(false), tag87(false)]);
// Composite converter admission: DLMM v0 E7/E9 and CLMM v0 E8 native converters build; CPMM spot/native/quiet, CLMM v1 and DLMM v1 are refused.
const nativeConv = (adapterType: number, externalWidth: number) => deriveMimirFusedRecipe({ role: "converter", adapterType, adapterVersion: 0,
  externalWidth, minSlotGap: 1, accountsBindingVersion: 1 });
const admitted = [nativeConv(3, 7), nativeConv(1, 8), nativeConv(3, 9)];
assert.deepEqual(admitted.map((r) => [r.adapterType, r.mode, r.externalWidth]), [[3, 2, 7], [1, 2, 8], [3, 2, 9]]);
const unadmitted = (label: string, r: Parameters<typeof deriveMimirFusedRecipe>[0]) =>
  assert.throws(() => assertMimirClassicConverterAdmitted([admitted[0]!, deriveMimirFusedRecipe(r)]),
    /CLASSIC_CONVERTER_UNSUPPORTED/, label);
const base = { role: "converter" as const, adapterVersion: 0, minSlotGap: 1, accountsBindingVersion: 1 };
unadmitted("CPMM spot", { ...base, adapterType: 2, externalWidth: 4 });
unadmitted("CPMM quiet", { ...base, adapterType: 2, externalWidth: 7, temporalModuleVersion: 2 });
unadmitted("CLMM v1 native E9", { ...base, adapterType: 1, adapterVersion: 1, externalWidth: 9 });
unadmitted("DLMM v1 native E8", { ...base, adapterType: 3, adapterVersion: 1, externalWidth: 8 });
unadmitted("DLMM v1 native E10", { ...base, adapterType: 3, adapterVersion: 1, externalWidth: 10 });
assertMimirClassicConverterAdmitted(admitted);
const admittedIx = buildMimirFusedCompositeRefreshInstruction({ programId: a(program), payer: a(pk(42)), compositeSnapshot: a(snapshot),
  compositeConfig: a(configAddress), registry: a(registry), adminConfig: a(adminConfig), feeVault: a(feeVault), treasury: a(pk(51)), execution: a(execution),
  layout: mimirCompositeExecutionLayout([cpmm], admitted), componentExternals: [ext(100, 4)], converterExternals: [ext(130, 7), ext(140, 8), ext(150, 9)],
  request: { compositeFeedId: feed, expectedConfigRevision: 1n, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n, componentSourceConfigRevisions: [1n],
    maxRefreshFeeLamports: 1_000n, componentRingNewestSlots: [0n], converterRingNewestSlots: [0n, 0n, 0n] } });
assert.equal(admittedIx.data[0], 87);
// The exported tag-87 and tag-88 builders refuse unadmitted converters themselves, before any instruction exists.
const typed = (e: unknown) => (e as { code?: string }).code === "CLASSIC_CONVERTER_UNSUPPORTED";
for (const [label, r] of [["CPMM native", { ...base, adapterType: 2, externalWidth: 5 }], ["CPMM spot", { ...base, adapterType: 2, externalWidth: 4 }],
  ["CLMM v1 native", { ...base, adapterType: 1, adapterVersion: 1, externalWidth: 9 }]] as const) {
  const bad = deriveMimirFusedRecipe(r); const layout = mimirCompositeExecutionLayout([cpmm], [bad]);
  assert.throws(() => buildMimirFusedCompositeRefreshInstruction({ programId: a(program), payer: a(pk(42)), compositeSnapshot: a(snapshot),
    compositeConfig: a(configAddress), registry: a(registry), adminConfig: a(adminConfig), feeVault: a(feeVault), treasury: a(pk(51)), execution: a(execution),
    layout, componentExternals: [ext(100, 4)], converterExternals: [ext(130, bad.externalWidth)],
    request: { compositeFeedId: feed, expectedConfigRevision: 1n, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n, componentSourceConfigRevisions: [1n],
      maxRefreshFeeLamports: 1_000n, componentRingNewestSlots: [0n], converterRingNewestSlots: [0n] } }), typed, `tag 87 ${label}`);
  assert.throws(() => buildMimirInitFusedCompositeClosure({ programId: a(program), payer: a(pk(42)), execution: a(execution), collateralLock: a(pk(43)), compositeConfig: a(configAddress),
    registry: a(registry), compositeFeedId: feed, layout, witnesses: [],
    components: [{ sourceConfig: a(pk(60)), feedConfig: a(pk(61)), sourcingPlan: a(pk(62)), externals: ext(100, 4) }],
    converter: { feedConfig: a(pk(63)), sourcingPlan: a(pk(64)), sources: [{ sourceConfig: a(pk(65)), externals: ext(130, bad.externalWidth) }] } }), typed, `tag 88 ${label}`);
  assert.throws(() => buildMimirInitFusedClosure({ tag: 88, programId: a(program), payer: a(pk(42)), execution: a(execution), collateralLock: a(pk(43)), feedId: feed, layout,
    witnesses: [], beginAccounts: [a(configAddress)], sealAccounts: [] }), typed, `generic tag 88 ${label}`);
}
console.log("composite tag-87 consumer pre-read tests passed");
