import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import { bytesAddress } from "../src/beta/bytes.js";
import { computeMimirBetaTickerTariff } from "../src/beta/abi.js";
import { compileMimirBetaTransactionV1 } from "../src/beta/transactionV1.js";
import {
  MIMIR_V1_MAINNET_PROGRAM_ID, MIMIR_V1_CREATE_MODE, encodeMimirV1CreateClassicData, encodeMimirV1CreateBeginData, encodeMimirV1GrowData,
  encodeMimirV1CreateCompositeData, buildMimirV1CreateCompositeInstruction, buildMimirV1TransferFeedInstruction,
  buildMimirV1InitGenerationCounterInstruction, buildMimirV1ClaimRefreshFeesInstruction, buildMimirV1ReclaimExcessRentInstruction,
  findMimirV1AdminConfigPda, findMimirV1ClassicFeedPda, findMimirV1CompositePda, findMimirV1GenerationCounterPda, findMimirV1IdentityClaimPda,
  findMimirV1RegistryPda, findMimirV1TickerClaimPda, findMimirV1TreasuryPda, findMimirV1SourceConfigAddress, deriveMimirV1ClassicFeedId, findMimirV1OneCharAllowancePda, findMimirV1FreeClassicVariant,
  buildMimirV1CreateClassicInstruction, computeMimirV1TickerTariff, computeMimirV1CompositeActivationFeeLamports,
  mimirV1ClassicExactLen, buildMimirV1FusedClassicRefreshInstruction, buildMimirV1FusedCompositeRefreshInstruction, mimirV1DirectDlmmWindow,
  type MimirV1ClassicDefinition, type MimirV1CreateClassicAccounts,
} from "../src/v1/build.js";
const tiers = [150, 30, 5, 2] as const;
import type { V1Descriptor } from "../src/v1/decoders.js";
import { MimirV1CreationTooLargeError, measureMimirV1Transaction, planMimirV1ClassicCreation, planMimirV1CompositeCreation, planMimirV1StagedCompositeCreation } from "../src/v1/tx.js";

const program = MIMIR_V1_MAINNET_PROGRAM_ID;
const programKey = new PublicKey(program);
const golden = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/layout_v1/${name}.bin`, import.meta.url)));
const key = (i: number) => bytesAddress(Uint8Array.from({ length: 32 }, (_, j) => j < 2 ? (i >> (8 * j)) & 0xff : (j * 7 + 1) & 0xff));
const web3Pda = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds.map((s) => Buffer.from(s)), programKey);
const enc = (s: string) => new TextEncoder().encode(s);

// PDAs: seeds from docs/LAYOUT_V1_CLASSIC.md §2.1.
{
  const feedId = key(1); const asset = key(2); const fid = new PublicKey(feedId).toBytes();
  const cases: [Promise<readonly [Address, number]>, Uint8Array[]][] = [
    [findMimirV1ClassicFeedPda(program, feedId), [enc("feed_snapshot"), fid]],
    [findMimirV1CompositePda(program, feedId), [enc("composite_snapshot"), fid]],
    [findMimirV1TickerClaimPda(program, "SOL"), [enc("ticker"), enc("SOL")]],
    [findMimirV1GenerationCounterPda(program), [enc("generation")]],
    [findMimirV1IdentityClaimPda(program, asset), [enc("identity_claim"), new PublicKey(asset).toBytes()]],
    [findMimirV1AdminConfigPda(program), [enc("admin_config"), Uint8Array.of(1, 0)]],
    [findMimirV1RegistryPda(program), [enc("mimir_registry"), Uint8Array.of(0, 0)]],
    [findMimirV1TreasuryPda(program), [enc("protocol_treasury"), Uint8Array.of(1, 0)]],
    [findMimirV1SourceConfigAddress(program, feedId, 2), [enc("source_config"), fid, Uint8Array.of(2)]],
  ];
  for (const [got, seeds] of cases) {
    const [addr, bump] = await got; const [want, wantBump] = web3Pda(...seeds);
    assert.equal(addr, want.toBase58()); assert.equal(bump, wantBump);
  }
  assert.throws(() => findMimirV1TickerClaimPda(program, "sol"));
  assert.throws(() => findMimirV1TickerClaimPda(program, "ABCDEFGHIJKLM"));
}

// feed_id (S-6): v1 mint-pair rule, variant 0 = `0x00`, variant v = `0x01 ‖ v u16`.
{
  const { createHash } = await import("node:crypto");
  const base = key(3); const quote = key(4);
  const want = createHash("sha256").update("MIMIR_MINT_PAIR_FEED_ID_V1").update(Buffer.of(0))
    .update(new PublicKey(base).toBytes()).update(new PublicKey(quote).toBytes()).digest();
  assert.equal(await deriveMimirV1ClassicFeedId(base, quote), new PublicKey(want).toBase58());
}

// Exact length = the frozen goldens (reference 2,506 B, SOL-quoted 5,251 B) and the MTP4 example (4,046 B).
const ref = golden("reference_usdc_cpmm_m0"); const solq = golden("sol_quoted_cpmm_m0");
const refDescriptor = ref.subarray(1558, 1574);
assert.equal(mimirV1ClassicExactLen([refDescriptor]), ref.length);
assert.equal(mimirV1ClassicExactLen([solq.subarray(1558, 1574)], [solq.subarray(4299, 4315)]), solq.length);
const mtp4 = Uint8Array.from(refDescriptor); mtp4[15] = 1; mtp4[14] = 4; mtp4[8] = 1280 & 0xff; mtp4[9] = 1280 >> 8;
assert.equal(mimirV1ClassicExactLen([mtp4]), 4046);

// CREATE_CLASSIC data, byte-exact (V1_WIRE §2.1): head 8 ‖ COLA u64 ‖ definition 645 ‖ n × 400 ‖ variant u16 = 663 + 400n.
const refDefinition: MimirV1ClassicDefinition = {
  feedImage: ref.slice(913, 1238), planImage: ref.slice(1238, 1558), rows: [{ descriptor: ref.slice(1558, 1574), sourceImage: ref.slice(1574, 1958) }], variant: 3,
};
const head = { n: 1, s: 0, targetBump: 254, tickerBump: 253, counterBump: 252 };
const cola = 1_000_000n;
{
  const data = encodeMimirV1CreateClassicData(MIMIR_V1_CREATE_MODE.SINGLE, head, cola, refDefinition);
  assert.deepEqual([...data.subarray(0, 16)], [93, 1, 0, 1, 0, 254, 253, 252, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0]);
  assert.equal(data.length, 663 + 400);
  assert.deepEqual(data.subarray(16, 1061), ref.subarray(913, 1958));
  assert.deepEqual([...data.subarray(1061)], [3, 0]);
  assert.equal(encodeMimirV1CreateClassicData(MIMIR_V1_CREATE_MODE.SEAL, head, cola, refDefinition)[2], 2);
  const begin = encodeMimirV1CreateBeginData(93, head, 16_567, key(9));
  assert.equal(begin.length, 44); assert.deepEqual([...begin.subarray(0, 12)], [93, 1, 1, 1, 0, 254, 253, 252, 0xb7, 0x40, 0, 0]);
  assert.deepEqual(begin.subarray(12), new PublicKey(key(9)).toBytes());
  assert.deepEqual([...encodeMimirV1GrowData(20_480)], [94, 1, 0x00, 0x50, 0, 0]);
  assert.throws(() => encodeMimirV1CreateClassicData(MIMIR_V1_CREATE_MODE.SINGLE, { ...head, n: 2 }, cola, refDefinition));
  assert.throws(() => encodeMimirV1CreateBeginData(93, head, 10_240, key(9)));
}

// CREATE_COMPOSITE data, byte-exact (V1_WIRE §2.3): 82 + 17N, the expected AdminConfig revision u64 LE at [74..82).
const compositeParams = {
  priceExponent: -8, riskTier: 2, routeabilityCap: 1, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 300,
  maxComponentConfidenceBps: 500, maxComponentDispersionBps: 700, ticker: "MAG2", quoteMint: key(30),
  components: [{ quantityX64: 1n << 64n, ownerDestination: false, coreAsset: false }, { quantityX64: (3n << 64n) | 5n, ownerDestination: true, coreAsset: true }],
};
{
  const cHead = { n: 2, s: 0, targetBump: 250, tickerBump: 249, counterBump: 252 };
  const data = encodeMimirV1CreateCompositeData(MIMIR_V1_CREATE_MODE.SINGLE, cHead, cola, 0x0807_0605_0403_0201n, compositeParams);
  assert.equal(data.length, 82 + 17 * 2);
  assert.deepEqual([...data.subarray(0, 42)], [95, 1, 0, 2, 0, 250, 249, 252, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0, 0xf8, 0xff, 0xff, 0xff, 2, 1,
    150, 0, 0x2c, 1, 0xf4, 1, 0xbc, 2, 4, 77, 65, 71, 50, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(data.subarray(42, 74), new PublicKey(key(30)).toBytes());
  assert.deepEqual([...data.subarray(74, 82)], [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...data.subarray(82, 116)], [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 3]);
  const accounts = { programId: program, payer: key(10), composite: key(20), tickerClaim: key(12), generationCounter: key(13), adminConfig: key(14), registry: key(15),
    treasury: key(21), colaMint: key(16), payerColaAta: key(17),
    children: [{ feed: key(31) }, { feed: key(32), f2CreditConsumed: true, ownerDestination: key(33), coreAsset: key(34) }] };
  for (const bad of [undefined, -1n, 1n << 64n, 7]) {
    assert.throws(() => encodeMimirV1CreateCompositeData(MIMIR_V1_CREATE_MODE.SINGLE, cHead, cola, bad as bigint, compositeParams), /AdminConfig revision/);
  }
  assert.equal(encodeMimirV1CreateCompositeData(MIMIR_V1_CREATE_MODE.SINGLE, cHead, cola, (1n << 64n) - 1n, compositeParams).length, 116);
  const built = buildMimirV1CreateCompositeInstruction({ ...accounts, mode: MIMIR_V1_CREATE_MODE.SINGLE, head: cHead, colaAmountRaw: cola, expectedAdminConfigRevision: 1n, params: compositeParams });
  assert.deepEqual(built.accounts.map((m) => [m.address, m.isSigner, m.isWritable]), [
    [key(10), true, true], [key(20), false, true], [key(12), false, true], [key(13), false, true], [key(14), false, false], [key(15), false, false],
    [key(21), false, true], [key(16), false, true], [key(17), false, true], ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", false, false],
    ["11111111111111111111111111111111", false, false], [key(31), false, false], [key(32), false, true], [key(33), false, true], [key(34), false, false]]);
  assert.throws(() => buildMimirV1CreateCompositeInstruction({ ...accounts, children: [{ feed: key(31) }, { feed: key(32) }], mode: 0, head: cHead, colaAmountRaw: cola, expectedAdminConfigRevision: 1n, params: compositeParams }));
  // The planner signs the revision of the AdminConfig it was priced from.
  const admin = { configRevision: 7n };
  const plan = planMimirV1CompositeCreation({ ...accounts, head: cHead, colaAmountRaw: cola, admin, params: compositeParams, finalLen: 3_288, feedId: key(35) });
  assert.equal(plan.grows, 0); assert.equal(plan.instructions.length, 1);
  assert.deepEqual([...plan.instructions[0]!.data.subarray(74, 82)], [7, 0, 0, 0, 0, 0, 0, 0]);
  // SPEC §4.3: N=5, 5 foreign attached children, grow (17,135 B) fits: 29 keys, < 1,500 B.
  const five = { ...accounts, children: Array.from({ length: 5 }, (_, i) => ({ feed: key(40 + i), ownerDestination: key(50 + i), coreAsset: key(60 + i) })) };
  const p5 = { ...compositeParams, components: Array.from({ length: 5 }, () => ({ quantityX64: 1n << 64n, ownerDestination: true, coreAsset: true })) };
  const big = planMimirV1CompositeCreation({ ...five, head: { ...cHead, n: 5 }, colaAmountRaw: cola, admin, params: p5, finalLen: 17_135, feedId: key(35) });
  assert.equal(big.grows, 1); assert.equal(big.instructions[0]!.data[0], 95); assert.equal(big.instructions[0]!.data[2], 1); assert.equal(big.instructions[2]!.data[2], 2);
  assert.equal(big.instructions[0]!.data.length, 44); assert.equal(big.instructions[2]!.data.length, 82 + 17 * 5);
  assert.deepEqual([...big.instructions[2]!.data.subarray(74, 82)], [7, 0, 0, 0, 0, 0, 0, 0]);
  assert.ok(big.size.keys <= 29 && big.size.bytes! < 1_500, JSON.stringify(big.size));
  console.log(`composite N=5 foreign attached grow: ${big.size.keys} keys ${big.size.bytes} B`);
  const staged = planMimirV1StagedCompositeCreation({ feePayer: key(10), childTransactions: [plan.instructions, plan.instructions], compositeTransaction: big.instructions });
  assert.equal(staged.length, 3); assert.deepEqual([...staged[2]!.at(-1)!.data.subarray(74, 82)], [7, 0, 0, 0, 0, 0, 0, 0]);
}

// 96, 103, 63, 91: data bytes and metas (V1_WIRE §2.4-2.13).
{
  const flags = (i: { accounts: readonly { address: string; isSigner: boolean; isWritable: boolean }[] }) => i.accounts.map((m) => `${m.isSigner ? "s" : ""}${m.isWritable ? "w" : "r"}`).join(",");
  const t96 = buildMimirV1TransferFeedInstruction({ programId: program, creator: key(1), target: key(2), identityClaim: key(3), identityClaimBump: 251, asset: key(4), agent: key(5), rootConfig: key(6), collection: key(7) });
  assert.deepEqual([...t96.data], [96, 1, 251]); assert.equal(flags(t96), "sw,w,w,r,r,r,r,r,r"); assert.equal(t96.accounts[7]!.address, "CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
  const t103 = buildMimirV1InitGenerationCounterInstruction({ programId: program, admin: key(1), adminConfig: key(2), counter: key(3) });
  assert.deepEqual([...t103.data], [103, 1]); assert.equal(flags(t103), "sw,r,w,r");
  const t63 = buildMimirV1ClaimRefreshFeesInstruction({ programId: program, composite: key(1), destination: key(2), asset: key(3), expectedOwnerClaimed: 258n, amount: 7n });
  assert.deepEqual([...t63.data], [63, 2, 1, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0]); assert.equal(flags(t63), "w,w,r");
  const t91 = buildMimirV1ReclaimExcessRentInstruction({ programId: program, target: key(1), creator: key(2), tickerClaimOwner: key(3) });
  assert.deepEqual([...t91.data], [91]); assert.equal(flags(t91), "w,w,r");
}

// Budgets of SPEC §4.3 with the exact serializer. ComputeBudget is message config in TxV1, so it is not a key here.
let next = 100;
function shape(n: number, width: number, s: number): MimirV1CreateClassicAccounts & { definition: MimirV1ClassicDefinition; head: typeof head; colaAmountRaw: bigint } {
  return {
    programId: program, payer: key(10), feed: key(11), tickerClaim: key(12), generationCounter: key(13), adminConfig: key(14), registry: key(15),
    colaMint: key(16), payerColaAta: key(17), sourceAccounts: Array.from({ length: n }, () => Array.from({ length: width }, () => key(next++))),
    ...(s > 0 ? { solFeed: key(18) } : {}),
    definition: { ...refDefinition, rows: Array.from({ length: n }, () => refDefinition.rows[0]!) }, head: { ...head, n, s }, colaAmountRaw: cola,
  };
}
const cuIx = { programAddress: "ComputeBudget111111111111111111111111111111" as Address, accounts: [], data: Uint8Array.of(2, 0x40, 0x5d, 0x15, 0) };
const table: [number, number, number, number, number, number][] = [
  // n, w, s, final len, expected keys (SPEC − ComputeBudget), expected grows
  [1, 4, 0, 2_506, 15, 0], [3, 8, 1, 9_227, 36, 0], [4, 8, 1, 10_695, 45, 1], [4, 8, 5, 16_567, 45, 1],
  [5, 4, 0, 7_598, 31, 0], [5, 4, 1, 10_603, 33, 1], [5, 4, 5, 15_435, 33, 1],
];
const report: string[] = [];
for (const [n, width, s, finalLen, keys, grows] of table) {
  const a = shape(n, width, s);
  const plan = planMimirV1ClassicCreation({ ...a, finalLen, feedId: key(19), prefix: [cuIx] });
  assert.equal(plan.grows, grows, `grows N=${n} w=${width} S=${s}`);
  assert.equal(plan.size.keys, keys, `keys N=${n} w=${width} S=${s}`);
  assert.ok(plan.size.bytes! <= 4_096);
  report.push(`N=${n} w=${width} S=${s}: ${plan.size.keys} keys ${plan.size.bytes} B grows ${plan.grows}`);
}
for (const width of [7, 8]) {
  assert.throws(() => planMimirV1ClassicCreation({ ...shape(5, width, 0), finalLen: 8_573, feedId: key(19), prefix: [cuIx] }),
    (e: unknown) => e instanceof MimirV1CreationTooLargeError && e.code === "CREATION_TOO_LARGE" && (e.bytes ?? 0) > 4_096);
}
console.log(report.join("\n"));

// The measure is the bytes compileMimirBetaTransactionV1 produces.
{
  const plan = planMimirV1ClassicCreation({ ...shape(1, 4, 0), finalLen: 2_506, feedId: key(19), prefix: [cuIx] });
  const compiled = await compileMimirBetaTransactionV1({ feePayer: key(10), recentBlockhash: "11111111111111111111111111111111", lastValidBlockHeight: 0n, instructions: plan.instructions });
  assert.equal(compiled.serializedTransaction.length, plan.size.bytes);
  assert.equal(compiled.packet.accountCount, plan.size.keys);
  assert.equal(measureMimirV1Transaction(key(10), plan.instructions).bytes, plan.size.bytes);
}

// Sequence: ≤ 10,240 one ix; 16,567 → BEGIN, GROW 20,480→capped 16,567, SEAL; BEGIN/GROW carry the instructions sysvar.
{
  const single = planMimirV1ClassicCreation({ ...shape(1, 4, 0), finalLen: 10_240, feedId: key(19) });
  assert.equal(single.instructions.length, 1); assert.equal(single.instructions[0]!.data[2], 0);
  const big = planMimirV1ClassicCreation({ ...shape(4, 8, 5), finalLen: 16_567, feedId: key(19) });
  assert.deepEqual(big.instructions.map((i) => [i.data[0], i.data[0] === 94 ? new DataView(i.data.buffer).getUint32(2, true) : i.data[2]]), [[93, 1], [94, 16_567], [93, 2]]);
  assert.equal(big.instructions[2]!.accounts.at(-1)!.address, "Sysvar1nstructions1111111111111111111111111");
}

// Refresh metas (SPEC §4.4): tag89 1 src = 6, SOL-quoted = 10; tag87 N=2 = 14, N=5 = 26.
{
  const req89 = (c: number, s: number) => ({ feedId: new Uint8Array(32).fill(7), declaredMaxSnapshotAge: 150, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n,
    componentCount: c, sourceSetRevision: 1n, planHash: new Uint8Array(32).fill(9), converterSourceCount: s, feedConfigRevision: 1n, ringNewestSlots: Array(c + s).fill(0n) });
  const vec = (k: number) => Array.from({ length: k }, () => Array.from({ length: 4 }, () => key(next++)));
  const desc = (o: Partial<V1Descriptor> = {}): { descriptor: V1Descriptor } => ({ descriptor: { minSlotGap: 0, externalWidth: 4, temporalKind: 0, moduleOffset: 0, moduleLen: 0,
    mode: 0, requiresIxSysvar: 0, adapterType: 2, adapterVersion: 0, bindingWidth: 4, bindingVersion: 0, derived: false, ...o } });
  const conv = (o: Partial<V1Descriptor> = {}) => desc({ adapterType: 3, mode: 2, ...o });
  const feed = (n: number, c: { descriptor: V1Descriptor }[] = []) => ({ rows: Array.from({ length: n }, () => desc()), converter: c.length ? { rows: c } : null });
  const t89 = buildMimirV1FusedClassicRefreshInstruction({ programId: program, feed: key(11), registry: key(15), decoded: feed(1), sourceAccounts: vec(1), request: req89(1, 0) });
  assert.equal(t89.accounts.length, 6); assert.deepEqual(t89.accounts[0], { address: key(11), isSigner: false, isWritable: true }); assert.equal(t89.data[0], 89);
  assert.equal(buildMimirV1FusedClassicRefreshInstruction({ programId: program, feed: key(11), registry: key(15), decoded: feed(1, [conv()]), sourceAccounts: vec(2), request: req89(1, 1) }).accounts.length, 10);
  // Sysvar iff any row, converter rows included, has descriptor byte 11 == 1.
  const sysvar = buildMimirV1FusedClassicRefreshInstruction({ programId: program, feed: key(11), registry: key(15), decoded: feed(1, [conv({ requiresIxSysvar: 1 })]), sourceAccounts: vec(2), request: req89(1, 1) });
  assert.equal(sysvar.accounts.length, 11); assert.equal(sysvar.accounts.at(-1)!.address, "Sysvar1nstructions1111111111111111111111111");
  assert.throws(() => buildMimirV1FusedClassicRefreshInstruction({ programId: program, feed: key(11), registry: key(15), decoded: feed(1, [conv({ externalWidth: 7 })]), sourceAccounts: vec(2), request: req89(1, 1) }), /vector width/);
  assert.throws(() => buildMimirV1FusedClassicRefreshInstruction({ programId: program, feed: key(11), registry: key(15), decoded: feed(1, [desc()]), sourceAccounts: vec(2), request: req89(1, 1) }), /CLASSIC_CONVERTER_UNSUPPORTED/);
  assert.throws(() => buildMimirV1FusedClassicRefreshInstruction({ programId: program, feed: key(11), registry: key(15), decoded: feed(2), sourceAccounts: vec(2), request: req89(1, 1) }), /vector count/);
  const req87 = (n: number) => ({ compositeFeedId: new Uint8Array(32).fill(8), expectedConfigRevision: 1n, previousSnapshotRevision: 0n, nextSnapshotRevision: 1n,
    componentSourceConfigRevisions: Array(n).fill(1n), maxRefreshFeeLamports: 0n, componentRingNewestSlots: Array(n).fill(0n), converterRingNewestSlots: [] });
  const base87 = { programId: program, payer: key(10), composite: key(20), registry: key(15), adminConfig: key(14), treasury: key(21), converterAccounts: [] };
  for (const [n, metas] of [[2, 14], [5, 26]] as const) {
    const t87 = buildMimirV1FusedCompositeRefreshInstruction({ ...base87, decoded: feed(n), componentAccounts: vec(n), request: { ...req87(n), maxRefreshFeeLamports: 1n } });
    assert.equal(t87.accounts.length, metas); assert.deepEqual(t87.accounts[1], { address: key(20), isSigner: false, isWritable: true }); assert.equal(t87.data[0], 87);
  }
  const s87 = buildMimirV1FusedCompositeRefreshInstruction({ ...base87, decoded: feed(2, [conv({ requiresIxSysvar: 1 })]), componentAccounts: vec(2), converterAccounts: vec(1),
    request: { ...req87(2), converterRingNewestSlots: [0n], maxRefreshFeeLamports: 1n } });
  assert.equal(s87.accounts.length, 19); assert.equal(s87.accounts.at(-1)!.address, "Sysvar1nstructions1111111111111111111111111");
  assert.throws(() => buildMimirV1FusedCompositeRefreshInstruction({ ...base87, decoded: feed(2), componentAccounts: vec(2), request: { ...req87(2), nextSnapshotRevision: 0n } }), /mode-4/);
  // Direct DLMM rows (static/derived binding) accept 1-2 row-local neighbour trailers after their exact base; every other recipe keeps exact E.
  const dlmm = (e: number, o: Partial<V1Descriptor> = {}) => desc({ adapterType: 3, mode: 1, externalWidth: e, bindingVersion: 3, ...o });
  assert.deepEqual([dlmm(4), dlmm(5, { adapterVersion: 1 }), dlmm(7, { mode: 2 }), dlmm(7, { mode: 2, temporalKind: 6 }), dlmm(7, { mode: 5, temporalKind: 5, adapterVersion: 1 }),
    dlmm(6, { mode: 0 }), dlmm(9, { mode: 2 }), dlmm(4, { bindingVersion: 0 }), desc()].map((r) => mimirV1DirectDlmmWindow(r.descriptor)),
    ["legacy", "legacy", "legacy", "dual", "point", null, null, null, null]);
  const wide = (k: number) => Array.from({ length: k }, () => key(next++));
  const t89n = (decoded: ReturnType<typeof feed>, v: string[]) => buildMimirV1FusedClassicRefreshInstruction({ programId: program, feed: key(11), registry: key(15),
    decoded, sourceAccounts: [v as Address[]], request: req89(1, 0) });
  const trailed = wide(6);
  assert.deepEqual(t89n({ rows: [dlmm(4)], converter: null }, trailed).accounts.slice(2).map((a) => a.address), trailed, "row-local trailers keep order");
  assert.throws(() => t89n({ rows: [dlmm(4)], converter: null }, wide(7)), /vector width/);
  assert.throws(() => t89n({ rows: [dlmm(6, { mode: 0 })], converter: null }, wide(7)), /vector width/);
  assert.throws(() => t89n(feed(1), wide(5)), /vector width/);
  assert.throws(() => t89n({ rows: [dlmm(4)], converter: null }, [...trailed.slice(0, 5), trailed[3]!]), /duplicate role/);
  assert.throws(() => t89n({ rows: [dlmm(4)], converter: null }, [...trailed.slice(0, 5), key(11)]), /writable alias/);
}

// MTP4 vectors (16-17 accounts per source), SPEC §4.3 "N ≤ 3 by keys; confirm with the exact serializer".
for (const [n, width] of [[2, 17], [3, 16], [3, 17], [4, 16]] as const) {
  const finalLen = mimirV1ClassicExactLen(Array(n).fill(mtp4));
  try {
    const p = planMimirV1ClassicCreation({ ...shape(n, width, 0), finalLen, feedId: key(19), prefix: [cuIx] });
    assert.ok(n <= 3);
    console.log(`MTP4 N=${n} w=${width}: ${p.size.keys} keys ${p.size.bytes} B fits`);
  } catch (e) {
    assert.ok(e instanceof MimirV1CreationTooLargeError, String(e));
    assert.equal(n, 4);
    console.log(`MTP4 N=${n} w=${width}: ${e.keys} keys ${e.bytes} B CREATION_TOO_LARGE`);
  }
}

// One-char ticker: the v1 allowance `["one-char", payer]` is the very last meta (w), iff the ticker is 1 char.
{
  const [allowance] = await findMimirV1OneCharAllowancePda(program, key(10));
  assert.equal(allowance, web3Pda(enc("one-char"), new PublicKey(key(10)).toBytes())[0].toBase58());
  const oneChar = { ...refDefinition, feedImage: Uint8Array.from(refDefinition.feedImage) }; oneChar.feedImage.set([1, 88, 0], 313);
  const base = { ...shape(1, 4, 1), solFeed: key(18), mode: MIMIR_V1_CREATE_MODE.SEAL as 2, colaAmountRaw: computeMimirV1TickerTariff(cola, "X", tiers) };
  assert.equal(base.colaAmountRaw, 0n);
  const seal = buildMimirV1CreateClassicInstruction({ ...base, definition: oneChar, oneCharAllowance: allowance });
  assert.deepEqual(seal.accounts.slice(-3).map((m) => [m.address, m.isWritable]), [[key(18), false], ["Sysvar1nstructions1111111111111111111111111", false], [allowance, true]]);
  assert.throws(() => buildMimirV1CreateClassicInstruction({ ...base, definition: oneChar }), /ONE_CHAR_ALLOWANCE_REQUIRED/);
  // CREATE-only Orca admission Oracles: read-only, after the source groups, before SOL / sysvar / allowance; source metas unchanged.
  const witnessed = buildMimirV1CreateClassicInstruction({ ...base, definition: oneChar, oneCharAllowance: allowance, orcaAdmissionOracles: [key(30), key(31)] });
  assert.deepEqual(witnessed.accounts.slice(-5).map((m) => [m.address, m.isWritable, m.isSigner]),
    [[key(30), false, false], [key(31), false, false], [key(18), false, false], ["Sysvar1nstructions1111111111111111111111111", false, false], [allowance, true, false]]);
  assert.deepEqual(witnessed.accounts.slice(0, -5), seal.accounts.slice(0, -3));
  assert.deepEqual(witnessed.data, seal.data);
  assert.throws(() => buildMimirV1CreateClassicInstruction({ ...base, definition: refDefinition, oneCharAllowance: allowance }), /ONE_CHAR_ALLOWANCE_REQUIRED/);
  assert.throws(() => buildMimirV1CreateClassicInstruction({ ...base, colaAmountRaw: cola, definition: oneChar, oneCharAllowance: allowance }), /ticker tariff/);
  encodeMimirV1CreateClassicData(MIMIR_V1_CREATE_MODE.SINGLE, head, 0n, refDefinition);
  for (const mode of [MIMIR_V1_CREATE_MODE.SINGLE, MIMIR_V1_CREATE_MODE.SEAL] as const) {
    assert.equal(new DataView(encodeMimirV1CreateCompositeData(mode, { ...head, n: 2 }, 0n, 1n, { ...compositeParams, ticker: "X" }).buffer).getBigUint64(8, true), 0n);
  }
  assert.throws(() => encodeMimirV1CreateCompositeData(0, { ...head, n: 2 }, cola, 1n, { ...compositeParams, ticker: "X" }), /ticker tariff/);
}

// Next free variant ≥ 1, one batched existence read.
{
  let reads = 0;
  const got = await findMimirV1FreeClassicVariant({ programId: program, baseMint: key(3), quoteMint: key(4), accountOwners: async (xs) => { reads++; return xs.map((_, i) => i < 2 ? program : i === 2 ? "11111111111111111111111111111111" as Address : null); } });
  assert.equal(reads, 1); assert.equal(got.variant, 3);
  assert.equal(got.feedId, await deriveMimirV1ClassicFeedId(key(3), key(4), 3));
  assert.deepEqual([got.feed, got.feedBump], await findMimirV1ClassicFeedPda(program, got.feedId));
  await assert.rejects(findMimirV1FreeClassicVariant({ programId: program, baseMint: key(3), quoteMint: key(4), maxVariant: 2, accountOwners: async (xs) => xs.map(() => program) }), /VARIANT_UNAVAILABLE/);
}
// Ticker tariff = v1 checked_ticker_tariff.
{
  assert.deepEqual(["A", "AB", "SOL", "ABCD", "ABCDE", "ABCDEFGHIJKL"].map((t) => computeMimirV1TickerTariff(10n, t, tiers)), [0n, 150n, 30n, 5n, 2n, 2n]);
  assert.throws(() => computeMimirV1TickerTariff(0n, "A", tiers), /INVALID_ARGUMENT/);
  assert.throws(() => computeMimirV1TickerTariff(3n, "ABCD", tiers), /INVALID_ARGUMENT/);
  assert.throws(() => computeMimirV1TickerTariff(4n, "ABCDE", tiers), /INVALID_ARGUMENT/);
  assert.throws(() => computeMimirV1TickerTariff(10n, "AB", [150, 30, 5]), /INVALID_ARGUMENT/);
  // Defaults reproduce the beta constants for every length 1..12, including their refusals and the u64 edge.
  for (const base of [10n, 50_000n, 1_000_000_000_000_000n, 7n, 3n, 4n, (1n << 64n) / 15n, (1n << 64n) / 15n + 1n]) {
    for (let length = 1; length <= 12; length++) {
      const t = "A".repeat(length); const run = (f: () => bigint) => { try { return f(); } catch { return "refused"; } };
      assert.equal(run(() => computeMimirV1TickerTariff(base, t, tiers)), run(() => computeMimirBetaTickerTariff(base, t)), `${base} ${length}`);
    }
  }
  assert.deepEqual(["AB", "SOL", "ABCD", "ABCDE"].map((t) => computeMimirV1TickerTariff(10n, t, [0, 10, 25, 1])), [0n, 10n, 25n, 1n]);
  assert.equal(new DataView(encodeMimirV1CreateCompositeData(0, { ...head, n: 2 }, 0n, 1n, { ...compositeParams, ticker: "AB" }).buffer).getBigUint64(8, true), 0n);
  const fees = { compositeActivationOwnerFeeLamports: 800_000n, compositeActivationTreasuryComponentFeeLamports: 700_000n, compositeActivationTreasuryCreationFeeLamports: 1_000_000n };
  for (let n = 2; n <= 5; n++) {
    assert.deepEqual(computeMimirV1CompositeActivationFeeLamports(fees, n), { owners: 800_000n * BigInt(n), treasury: 700_000n * BigInt(n) + 1_000_000n, total: 1_500_000n * BigInt(n) + 1_000_000n });
  }
  assert.equal(computeMimirV1CompositeActivationFeeLamports(fees, 3, 1).total, 800_000n + 3n * 700_000n + 1_000_000n);
  assert.throws(() => computeMimirV1CompositeActivationFeeLamports(fees, 1), /INVALID_ARGUMENT/);
  for (const [credits, treasury] of [[0, 3_100_000n], [2, 1_700_000n], [3, 1_000_000n]] as const) {
    assert.deepEqual(computeMimirV1CompositeActivationFeeLamports(fees, 3, 0, credits), { owners: 0n, treasury, total: treasury });
  }
  assert.deepEqual(computeMimirV1CompositeActivationFeeLamports(fees, 2, 0, 0, 1), { owners: 0n, treasury: 3_200_000n, total: 3_200_000n });
  assert.deepEqual(computeMimirV1CompositeActivationFeeLamports(fees, 4, 1, 1, 2), { owners: 800_000n, treasury: 4_700_000n, total: 5_500_000n });
  for (const args of [[3, 0, 4], [3, 0, -1], [3, 2, 0, 2], [2, 3]] as const) {
    assert.throws(() => computeMimirV1CompositeActivationFeeLamports(fees, ...(args as unknown as [number])), /INVALID_ARGUMENT/);
  }
}
// CREATE_COMPOSITE representability (program mantissa_domain_is_feasible → InvalidExponent), refused before any effect.
{
  const { mimirV1CompositeMantissaDomainFeasible: feasible } = await import("../src/v1/build.js");
  const Q = 1n << 64n;
  assert.deepEqual([feasible([1n, 1n], 19), feasible([1n, 1n], 0), feasible([Q, Q], 19), feasible([1n, 1n], -36), feasible([1n << 120n, 1n << 120n], -36)],
    [false, true, true, true, false]);
  const head2 = { n: 2, s: 0, targetBump: 250, tickerBump: 249, counterBump: 252 };
  const tiny = { ...compositeParams, priceExponent: 19, components: compositeParams.components.map((c) => ({ ...c, quantityX64: 1n })) };
  assert.throws(() => encodeMimirV1CreateCompositeData(MIMIR_V1_CREATE_MODE.SINGLE, head2, cola, 1n, tiny), /InvalidExponent/);
}
console.log("v1Builders ok");
