import assert from "node:assert/strict";
import { mock } from "node:test";
import { readFileSync } from "node:fs";
import { ComputeBudgetProgram, PublicKey, SystemProgram } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import type { MimirFusedRecipe } from "../src/beta/compositeExecution.js";

const program = new PublicKey(new Uint8Array(32).fill(31)), payer = new PublicKey(new Uint8Array(32).fill(32)).toBase58() as Address;
const pda = (seed: string, ...values: (Uint8Array | number[])[]) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...values.map((v) => Buffer.from(v))], program)[0];
const id = (n: number) => new Uint8Array(32).fill(n);
const b58 = (k: PublicKey) => k.toBase58() as Address;
const ext = (feed: number, n: number) => Array.from({ length: n }, (_, i) => b58(new PublicKey(new Uint8Array(32).fill(100 + feed * 10 + i))));

// Components: 1 = CPMM (native 5-role tag 77, fused as the 4-role spot projection), 2 = CLMM v0 routeable (7). Converter 9 = DLMM v0 native (7).
const adapterOf: Record<number, number> = { 1: 2, 2: 1, 4: 4, 9: 3 };
const widthOf: Record<number, number> = { 1: 5, 2: 7, 4: 8, 9: 7 };
let components = [1, 2], conversion = true;
const builds: number[] = [];

const codecUrl = new URL("../src/codec.ts", import.meta.url), codec = await import(codecUrl.href);
mock.module(codecUrl.href, { namedExports: { ...codec,
  decodeCompositeFeedConfigHeader: () => ({ compositeFeedId: id(77), configRevision: 1n, priceExponent: -8, maxSnapshotAgeSlots: 30,
    maxComponentSnapshotAgeSlots: 20, components: components.map((f) => ({ feedId: id(f), sourceConfig: pda("source_config", id(f), [0]).toBytes() })),
    solConversionSourceConfig: conversion ? pda("source_config", id(9), [0]).toBytes() : new Uint8Array(32) }),
  decodeAdminConfigHeader: () => ({ feeTreasury: new Uint8Array(32).fill(33), compositeRefreshFeeLamports: 5n }) } });
const sourceUrl = new URL("../src/internal/nativeMonoRefreshCore.ts", import.meta.url), source = await import(sourceUrl.href);
mock.module(sourceUrl.href, { namedExports: { ...source, decodeSourceConfigHeader: (d: Uint8Array) => ({ adapterType: adapterOf[d[0]!]! }) } });
const abiUrl = new URL("../src/beta/liveAbi.ts", import.meta.url), abi = await import(abiUrl.href);
mock.module(abiUrl.href, { namedExports: { ...abi,
  decodeMimirBetaLiveSource: (d: Uint8Array) => ({ adapterType: adapterOf[d[0]!]!, adapterVersion: 0, sourceIndex: 0, temporalMode: "sampled" }),
  decodeMimirBetaLivePlan: async () => ({ accountsBindingVersion: 1 }) } });
const tag77Data = (feed: number, source: number) => {
  const data = new Uint8Array(286); const dv = new DataView(data.buffer);
  data[0] = 77; data.set(id(feed), 1); data[33] = source; dv.setUint16(34, 1, true); dv.setUint16(36, 1, true);
  dv.setBigUint64(38, 1n, true); dv.setBigUint64(46, 1n, true);
  return data;
};
const tag77 = (feed: number, source = 0) => ({ programAddress: b58(program), data: tag77Data(feed, source),
  accounts: [{ address: payer, isSigner: true, isWritable: true }, { address: b58(pda("source_ring", id(feed), [source], [1, 0])), isSigner: false, isWritable: true },
    ...[pda("source_config", id(feed), [source]), pda("feed_config", id(feed)), pda("sourcing_plan", id(feed)), pda("mimir_registry", [0, 0])]
      .map((k) => ({ address: b58(k), isSigner: false, isWritable: false })),
    ...ext(feed, widthOf[feed]!).map((address) => ({ address, isSigner: false, isWritable: false })),
    { address: b58(SystemProgram.programId), isSigner: false, isWritable: false }] });
const rowsUrl = new URL("../src/existingFeedRows.ts", import.meta.url), rowsModule = await import(rowsUrl.href);
mock.module(rowsUrl.href, { namedExports: { ...rowsModule,
  buildMimirExistingFeedFusedRows: async (a: { feedId: Uint8Array; role: string }) => {
    const feed = a.feedId[0]!; builds.push(feed);
    const role = a.role === "component" ? "component" : "converter";
    const externalWidth = role === "component" && feed === 1 ? 4 : widthOf[feed]!;
    return [{ recipe: deriveMimirFusedRecipe({ role, adapterType: adapterOf[feed]!, adapterVersion: 0, externalWidth, minSlotGap: 1, accountsBindingVersion: 1,
        ...([4, 6].includes(adapterOf[feed]!) ? { temporalModuleVersion: 4 } : {}) }),
      witness: { feedId: id(feed), sourceIndex: 0, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n,
        expectedPlanHash: new Uint8Array(32), sourceSetSiblings: [0, 1, 2].map(() => new Uint8Array(32)), accountsSiblings: [0, 1, 2].map(() => new Uint8Array(32)) },
      externals: ext(feed, externalWidth), sourceConfig: b58(pda("source_config", id(feed), [0])), feedConfig: b58(pda("feed_config", id(feed))),
      sourcingPlan: b58(pda("sourcing_plan", id(feed))) }];
  } } });
const { deriveMimirFusedRecipe, encodeMimirFusedDescriptor, mimirCompositeExecutionLayout, mimirFusedRecipeBindingVariant } = await import("../src/beta/compositeExecution.js");
const { mimirRecipeTupleKey } = await import("../src/beta/abi1Release.js");
const { createMimirRefreshGroupBuilder, MimirCompositeExecutionExistsError, mimirRefreshWarmingRecovery } = await import("../src/refreshGroup.js");
const { canonicalRowImages } = await import("./fixtures/compositeExecutionImage.js");

const component: MimirFusedRecipe = deriveMimirFusedRecipe({ role: "component", adapterType: 2, adapterVersion: 0, externalWidth: 4, minSlotGap: 1, accountsBindingVersion: 1 });
const clmm = deriveMimirFusedRecipe({ role: "component", adapterType: 1, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion: 1 });
const converter = deriveMimirFusedRecipe({ role: "converter", adapterType: 3, adapterVersion: 0, externalWidth: 7, minSlotGap: 1, accountsBindingVersion: 1 });
const frozenRow = Uint8Array.from(Buffer.from(readFileSync(new URL("./fixtures/abi1/phones-execution-post-seal.hex", import.meta.url), "utf8"), "hex")).subarray(128, 128 + 1_621);
const frozenRing = Uint8Array.from(Buffer.from(readFileSync(new URL("./fixtures/abi1/phones-execution-post-tag87.hex", import.meta.url), "utf8"), "hex")).subarray(128 + 1_077, 128 + 1_621);
const executionImage = (rows: MimirFusedRecipe[], conv: MimirFusedRecipe[], status = 1, cfc = pda("composite_feed_config", id(77))) => {
  const layout = mimirCompositeExecutionLayout(rows, conv);
  const data = new Uint8Array(layout.exactLength); const dv = new DataView(data.buffer);
  data.set(new TextEncoder().encode("MIMIRCEF")); dv.setUint16(8, 1, true); dv.setUint16(10, 128, true); dv.setUint32(12, data.length, true);
  data.set(id(77), 16); data.set(cfc.toBytes(), 48); data.fill(7, 80, 112); dv.setBigUint64(112, 1n, true); data[120] = rows.length; data[122] = status; data[123] = conv.length;
  const b = 128 + 1_621 * rows.length;
  const convImages = conv.length ? canonicalRowImages(id(30), layout.descriptors.slice(rows.length)) : null;
  layout.descriptors.forEach((d, r) => {
    const o = r < rows.length ? 128 + 1_621 * r : b + 1_829 + 944 * (r - rows.length);
    data.set(encodeMimirFusedDescriptor(d), o); dv.setBigUint64(o + 16 + 360, 1n, true);
    data.set(frozenRing, o + (r < rows.length ? 1_077 : 400));
    const m = layout.membershipOffsets[r]!; data[m] = d.bindingWidth; data[m + 1] = 1; data[m + 2] = d.adapterType === 1 ? 1 : 0;
    // Seal-copied images: the frozen-ELF PHONES row-0 source/feed/plan for the CPMM component, canonical images for the other rows.
    if (r === 0 && d.adapterType === 2) { data.set(frozenRow.subarray(16, 1_077), o + 16); return; }
    const im = r < rows.length ? canonicalRowImages(id(10 + r), [d]) : convImages!;
    data.set(im.sources[r < rows.length ? 0 : r - rows.length]!, o + 16);
    if (r < rows.length) { data.set(im.feed, o + 400); data.set(im.plan, o + 757); }
  });
  if (conv.length) { data.set(convImages!.feed, b); data.set(convImages!.plan, b + 357); }
  return data;
};

const accounts = new Map<string, Uint8Array>();
const snap = new Uint8Array(720); new DataView(snap.buffer).setBigUint64(96, 3n, true);
for (const f of [1, 2, 4, 9]) { const sc = new Uint8Array(384); sc[0] = f; sc.set(id(f), 16); accounts.set(pda("source_config", id(f), [0]).toBase58(), sc);
  accounts.set(pda("sourcing_plan", id(f)).toBase58(), new Uint8Array(320)); }
accounts.set(pda("composite_snapshot", id(77)).toBase58(), snap);
accounts.set(pda("feed_snapshot", id(9)).toBase58(), new Uint8Array(512));
accounts.set(pda("admin_config", [1, 0]).toBase58(), new Uint8Array(8));
accounts.set(pda("composite_feed_config", id(77)).toBase58(), new Uint8Array(8));
const executionKey = pda("composite_execution", id(77)).toBase58();
const info = (key: PublicKey) => accounts.has(key.toBase58()) ? { owner: key.toBase58().startsWith("SysvarC1ock") ? new PublicKey("Sysvar1111111111111111111111111111111111111") : program, executable: false, lamports: 1, data: Buffer.from(accounts.get(key.toBase58())!) } : null;
const connection = { getAccountInfo: async (key: PublicKey) => info(key), getMultipleAccountsInfo: async (keys: PublicKey[]) => keys.map(info),
  getMultipleAccountsInfoAndContext: async (keys: PublicKey[]) => ({ context: { slot: 7 }, value: keys.map(info) }),
  getAccountInfoAndContext: async (key: PublicKey) => ({ context: { slot: 7 }, value: await connection.getAccountInfo(key) }) };
const builder = createMimirRefreshGroupBuilder({ connection: connection as never, profile: { cluster: "localnet", name: "custom", programId: program } as never, payer });
const target = { kind: "composite", compositeConfig: b58(pda("composite_feed_config", id(77))) } as const;

// One indivisible tag-87 unit: no updates, no recurring definition/ring accounts, CAS from the private execution state.
{
  accounts.set(executionKey, executionImage([component, clmm], [converter]));
  const group = await builder(target);
  assert.deepEqual(group.updates, []);
  assert.deepEqual(group.publish.instructions.map((i) => i.data[0]), [87]);
  assert.equal(group.publish.computeUnitBound, undefined, "CU is measured by simulation, never inferred");
  const ix = group.publish.instructions[0]!;
  assert.equal(ix.accounts[8]!.address, executionKey);
  assert.deepEqual(ix.accounts.slice(9).map((a) => a.address), [...ext(1, 4), ...ext(2, 7), ...ext(9, 7)]);
  assert.ok(ix.accounts.slice(9).every((a) => !a.isWritable && !a.isSigner));
  assert.ok(!ix.accounts.some((a) => [pda("source_ring", id(1), [0], [1, 0]), pda("feed_snapshot", id(9)), pda("source_config", id(1), [0])]
    .some((k) => k.toBase58() === a.address)), "no recurring ring/snapshot/source-config metas");
  const dv = new DataView(ix.data.buffer, ix.data.byteOffset);
  assert.equal(ix.data.length, 106 + 8 * 3);
  assert.deepEqual([dv.getBigUint64(41, true), dv.getBigUint64(49, true), ix.data[57]], [3n, 4n, 2]);
  assert.deepEqual([106, 114, 122].map((o) => dv.getBigUint64(o, true)), [508_831_055n, 508_831_055n, 508_831_055n]);
  assert.deepEqual(builds.sort(), [1, 2, 9]);
}

// No converter: component vectors only.
{
  components = [2]; conversion = false;
  accounts.set(executionKey, executionImage([clmm], []));
  const ix = (await builder(target)).publish.instructions[0]!;
  assert.deepEqual(ix.accounts.slice(9).map((a) => a.address), ext(2, 7));
}

// A1 §5 sampler: an unready mode-4 row yields only the permissionless r/r fee-zero tag 87 (absent CSP => 0/0), never a publish.
{
  components = [4]; conversion = false;
  const amm = deriveMimirFusedRecipe({ role: "component", adapterType: 4, adapterVersion: 0, externalWidth: 8, temporalModuleVersion: 4, minSlotGap: 1, accountsBindingVersion: 1 });
  accounts.set(executionKey, executionImage([amm], []));
  const clock = new Uint8Array(40); new DataView(clock.buffer).setBigInt64(32, 2_000_000n, true); accounts.set("SysvarC1ock11111111111111111111111111111111", clock);
  const csp = accounts.get(pda("composite_snapshot", id(77)).toBase58())!; accounts.delete(pda("composite_snapshot", id(77)).toBase58());
  const recovery = mimirRefreshWarmingRecovery(await builder(target).then(() => null, (e: unknown) => e))!;
  const sample = recovery.refreshOnlyInstructions[0]!; const dv = new DataView(sample.data.buffer, sample.data.byteOffset);
  assert.deepEqual([sample.data[0], dv.getBigUint64(41, true), dv.getBigUint64(49, true), dv.getBigUint64(98, true)], [87, 0n, 0n, 0n]);
  assert.equal(sample.accounts.at(-1)!.address, "Sysvar1nstructions1111111111111111111111111");
  assert.deepEqual([recovery.sampled?.status, recovery.sampled?.observationsRemaining], ["warming", 13]);
  const capable = (action: "sample" | "publish") => {
    const tuple = mimirRecipeTupleKey(amm);
    const cell = { id: "c", action, executionKind: "composite", primarySourceCount: 1, converterSourceCount: 0, sourceCount: 1, converter: false, recipe: tuple,
      recipeTupleKeys: [tuple], status: "measured", cuAfter: 1, fixtureSha256: "1".repeat(64), outputSha256: "2".repeat(64), instructionsSha256: "3".repeat(64) };
    return createMimirRefreshGroupBuilder({ connection: connection as never, profile: { cluster: "devnet", name: "custom", programId: program } as never, payer,
      abi1Capability: { manifestSha256: "", cells: new Map([["c", cell]]), manifest: { clusterGenesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG", programId: b58(program), recipes: [{ adapterType: amm.adapterType,
        adapterVersion: amm.adapterVersion, mode: amm.mode, temporalKind: amm.temporalKind, externalWidth: amm.externalWidth, bindingWidth: amm.bindingWidth,
        accountsBindingVersion: amm.accountsBindingVersion, bindingVariant: mimirFusedRecipeBindingVariant(amm), clusterEnabled: true,
        exactElfCells: { [action]: ["c"] } }] } } as never });
  };
  for (const action of ["publish", "sample"] as const) {
    await assert.rejects(capable(action)(target), /mode-4 arm outside the release recipe scope/, "a sampled mode-4 row is outside the release scope off localnet");
  }
  accounts.set(pda("composite_snapshot", id(77)).toBase58(), csp);
  const existing = mimirRefreshWarmingRecovery(await builder(target).then(() => null, (e: unknown) => e))!.refreshOnlyInstructions[0]!;
  assert.deepEqual([41, 49].map((o) => new DataView(existing.data.buffer, existing.data.byteOffset).getBigUint64(o, true)), [3n, 3n]);
  components = [2];
}

// Fail closed: no lazy initialization, inactive/foreign state, or recipe width drift.
{
  accounts.delete(executionKey);
  await assert.rejects(builder(target), /MimirAccountMissing/);
  accounts.set(executionKey, executionImage([clmm], [], 0));
  await assert.rejects(builder(target), /CompositeExecutionNotReady/);
  accounts.set(executionKey, executionImage([clmm], [], 1, pda("other", id(1))));
  await assert.rejects(builder(target), /CompositeExecutionNotReady/);
  accounts.set(executionKey, executionImage([{ ...clmm, externalWidth: 8, mode: 2 }], []));
  await assert.rejects(builder(target), /ExecutionDefinitionMismatch/);
  const live = accounts.get(executionKey)!; accounts.set(executionKey, new Uint8Array(live.length));
  const { getAccountInfo, getMultipleAccountsInfoAndContext } = connection;
  connection.getMultipleAccountsInfoAndContext = async () => { throw new Error("Network busy (429)"); };
  connection.getAccountInfo = async (key: PublicKey) => {
    if (key.equals(pda("composite_snapshot", id(77)))) throw new Error("Network busy (429)");
    await new Promise((r) => setTimeout(r, 5)); return getAccountInfo(key); };
  await assert.rejects(builder(target), (e: { code?: string }) => e.code === "PROGRAM_ABI_MISMATCH", "invalid execution outranks a concurrent read failure");
  Object.assign(connection, { getAccountInfo, getMultipleAccountsInfoAndContext }); accounts.set(executionKey, live);
  components = [1, 2]; conversion = true;
  accounts.set(executionKey, executionImage([component, clmm], []));
  await assert.rejects(builder(target), /CompositeExecutionNotReady|ExecutionDefinitionMismatch/);
}

// Existing-CFC cutover initializer: the same complete tag-88 closure, from the live definitions; refuses an existing execution PDA.
{
  components = [1, 2]; conversion = true;
  accounts.delete(executionKey);
  const lockKey = pda("feed_collateral_lock", id(77)).toBase58();
  const lock = (creator: Address, status = 1, amount = 1n) => { const d = new Uint8Array(160); const v = new DataView(d.buffer);
    d.set(Buffer.from("MIMIRCOL")); v.setUint16(10, 160, true); d.set(id(77), 16); d.set(new PublicKey(creator).toBytes(), 48); d.set(id(5), 80);
    v.setBigUint64(112, amount, true); v.setBigUint64(120, 1n, true); d[144] = status; return d; };
  await assert.rejects(builder.compositeInitializer!(target.compositeConfig), /ACCOUNT_MALFORMED/, "missing collateral lock refuses before tag 88");
  accounts.set(lockKey, lock(b58(pda("other", id(2)))));
  await assert.rejects(builder.compositeInitializer!(target.compositeConfig), /INIT_PAYER_NOT_FEED_CREATOR/, "non-creator payer refuses before tag 88");
  accounts.set(lockKey, lock(b58(pda("other", id(2))), 2, 0n));
  await assert.rejects(builder.compositeInitializer!(target.compositeConfig), /INIT_PAYER_NOT_FEED_CREATOR/, "non-creator one-character lock refuses before tag 88");
  for (const [status, amount] of [[1, 0n], [2, 1n]] as const) {
    accounts.set(lockKey, lock(payer, status, amount));
    await assert.rejects(builder.compositeInitializer!(target.compositeConfig), /ACCOUNT_MALFORMED/, "mismatched lock status/amount refuses before tag 88");
  }
  accounts.set(lockKey, lock(payer, 2, 0n));
  adapterOf[9] = 2; widthOf[9] = 5;
  await assert.rejects(builder.compositeInitializer!(target.compositeConfig), /CLASSIC_CONVERTER_UNSUPPORTED/, "CPMM-native converter is refused before tag 88");
  adapterOf[9] = 3; widthOf[9] = 9;
  const init = await builder.compositeInitializer!(target.compositeConfig);
  assert.equal(init.execution, executionKey);
  assert.deepEqual(init.instructions.map((i) => [i.data[0], i.data[1]]), [[88, 0], [88, 2]]);
  assert.equal(init.exactLength, 128 + 1_621 * 2 + 1_829 + 944 + 3 * (4 + 65 * 4) - 65);
  assert.deepEqual(init.instructions[0]!.accounts.slice(-3).map((a) => [a.address, a.isWritable]), [["11111111111111111111111111111111", false],
    ["Sysvar1nstructions1111111111111111111111111", false], [lockKey, false]]);
  assert.equal(new DataView(init.instructions[0]!.data.buffer, init.instructions[0]!.data.byteOffset).getUint32(36, true), init.exactLength);
  const seal = init.instructions[1]!;
  assert.equal(seal.data.length, 36 + 301 * 3);
  assert.deepEqual([seal.data[34], seal.data[35]], [2, 1]);
  assert.deepEqual(seal.accounts.slice(5, 8).map((a) => a.address), [pda("source_config", id(1), [0]), pda("feed_config", id(1)), pda("sourcing_plan", id(1))].map(b58));
  assert.deepEqual(seal.accounts.slice(8, 12).map((a) => a.address), ext(1, 4), "CPMM component seals the 4-role spot projection");
  assert.equal(seal.accounts.at(-1)!.address, "Sysvar1nstructions1111111111111111111111111");
  assert.equal(init.temporalWarmupRequired, false);
  accounts.set(executionKey, executionImage([component, clmm], [converter]));
  const exists = await builder.compositeInitializer!(target.compositeConfig).then(() => null, (e: unknown) => e);
  assert.ok(exists instanceof MimirCompositeExecutionExistsError && exists.message === "CompositeExecutionAlreadyExists");
  assert.deepEqual([...exists.reuse.prefetchedAccounts!.entries()].map(([k, v]) => [k, v.slot]), [[target.compositeConfig, 7n], [executionKey, 7n]]);
  adapterOf[9] = 3; widthOf[9] = 7;
  assert.equal((await builder(target, exists.reuse)).publish.instructions[0]!.accounts[8]!.address, executionKey, "probe read serves the same preparation's build");
}

// Recurring tag 87 over a sealed CPMM-native converter row is refused with the typed admission error.
{
  components = [1, 2]; conversion = true; adapterOf[9] = 2; widthOf[9] = 5;
  const cpmmConverter = deriveMimirFusedRecipe({ role: "converter", adapterType: 2, adapterVersion: 0, externalWidth: 5, minSlotGap: 1, accountsBindingVersion: 1 });
  accounts.set(executionKey, executionImage([component, clmm], [cpmmConverter]));
  await assert.rejects(builder(target), (e: { code?: string }) => e.code === "CLASSIC_CONVERTER_UNSUPPORTED");
  adapterOf[9] = 3; widthOf[9] = 7;
}

mock.restoreAll();
console.log("composite fused tag-87 producer tests passed");
