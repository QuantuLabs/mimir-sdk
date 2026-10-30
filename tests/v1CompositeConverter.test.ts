import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import { bytesAddress } from "../src/beta/bytes.js";
import { MIMIR_V1_MAINNET_PROGRAM_ID, deriveMimirV1ClassicFeedId, deriveMimirV1CompositeFeedId, findMimirV1ClassicFeedPda, findMimirV1SourceConfigAddress } from "../src/v1/build.js";
import { MIMIR_V1_NATIVE_MINT, deriveMimirV1CompositeFeedIdFromFeeds, findMimirV1SolFeedPda, mimirV1CompositeParamRows, mimirV1CompositeShape, planMimirV1CompositeCreationFromFeeds } from "../src/v1/composite.js";
import type { V1ClassicFeed, V1Descriptor } from "../src/v1/decoders.js";

// CREATE_COMPOSITE with converter rows (V1_WIRE §2.3, LAYOUT_V1_COMPOSITE B7): N2S1 and N5S1, the SOL feed also a component.
const program = MIMIR_V1_MAINNET_PROGRAM_ID;
const key = (i: number) => bytesAddress(Uint8Array.from({ length: 32 }, (_, j) => j < 2 ? (i >> (8 * j)) & 0xff : (j * 7 + 1) & 0xff));
const bytes = (a: Address) => new PublicKey(a).toBytes();
const USDC = key(900);

const descriptor = (o: Partial<V1Descriptor> = {}): V1Descriptor => ({ minSlotGap: 0, externalWidth: 4, temporalKind: 0, moduleOffset: 0, moduleLen: 0, mode: 1,
  requiresIxSysvar: 0, adapterType: 0, adapterVersion: 0, bindingWidth: 4, bindingVersion: 3, derived: true, ...o });
/** A decoded one-row (or `n`-row) Classic: row-0 source quote @264, feed image base @48 / quote @80. */
function feed(self: Address, feedIdByte: number, quote: Address, o: { n?: number; d?: Partial<V1Descriptor>; base?: Address } = {}): V1ClassicFeed {
  const source = new Uint8Array(384); source.set(bytes(quote), 264);
  const feedImage = new Uint8Array(325); feedImage.set(bytes(o.base ?? key(800 + feedIdByte)), 48); feedImage.set(bytes(quote), 80);
  const d = descriptor(o.d);
  const rows = Array.from({ length: o.n ?? 1 }, () => ({ descriptor: d, source, ring: new Uint8Array(544) }));
  return { selfAddress: self, feedId: Uint8Array.from({ length: 32 }, (_, i) => i === 0 ? feedIdByte : 0), header: { n: o.n ?? 1, s: 0 },
    rows, converter: null, definition: { feedImage, planImage: new Uint8Array(320) },
    memberships: rows.map(() => ({ bindingWidth: d.bindingWidth, planBinding: 1, bindingVariant: 0, derived: d.derived, tuples: [] })) } as unknown as V1ClassicFeed;
}

// The SOL feed PDA is the variant-0 SOL/quote Classic.
assert.deepEqual(await findMimirV1SolFeedPda(program, USDC), await findMimirV1ClassicFeedPda(program, await deriveMimirV1ClassicFeedId(MIMIR_V1_NATIVE_MINT, USDC, 0)));

const solFeedAddress = key(100);
const solFeed = feed(solFeedAddress, 1, USDC, { base: MIMIR_V1_NATIVE_MINT, d: { adapterType: 1, mode: 2 } });
const solQuoted = feed(key(101), 2, MIMIR_V1_NATIVE_MINT, { d: { adapterType: 0 } });
const accounts = { programId: program, payer: key(10), composite: key(20), tickerClaim: key(12), generationCounter: key(13), adminConfig: key(14), registry: key(15),
  treasury: key(21), colaMint: key(16), payerColaAta: key(17) };
const head = { targetBump: 250, tickerBump: 249, counterBump: 252 };
const params = (n: number) => ({ priceExponent: -8, riskTier: 0, routeabilityCap: 4, maxSnapshotAgeSlots: 150, maxComponentSnapshotAgeSlots: 120,
  maxComponentConfidenceBps: 200, maxComponentDispersionBps: 300, ticker: "SOLX", quoteMint: USDC,
  components: Array.from({ length: n }, () => ({ quantityX64: 1n << 64n, ownerDestination: false, coreAsset: false })) });
const SPL = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"; const SYSTEM = "11111111111111111111111111111111";
const fixedMetas = [[key(10), true, true], [key(20), false, true], [key(12), false, true], [key(13), false, true], [key(14), false, false], [key(15), false, false],
  [key(21), false, true], [key(16), false, true], [key(17), false, true], [SPL, false, false], [SYSTEM, false, false]];
const metas = (i: { accounts: readonly { address: string; isSigner: boolean; isWritable: boolean }[] }) => i.accounts.map((m) => [m.address, m.isSigner, m.isWritable]);
/** Wire bytes [0..82) for s = 1 (AdminConfig revision 7 at 74), then 17 B per component (1.0 quantity, flags 0). */
const wire = (n: number) => [95, 1, 0, n, 1, 250, 249, 252, 0x40, 0x42, 0x0f, 0, 0, 0, 0, 0, 0xf8, 0xff, 0xff, 0xff, 0, 4, 150, 0, 120, 0, 200, 0, 0x2c, 1,
  4, 83, 79, 76, 88, 0, 0, 0, 0, 0, 0, 0, ...bytes(USDC), 7, 0, 0, 0, 0, 0, 0, 0, ...Array.from({ length: n }, () => [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]).flat()];
const cola = 1_000_000n;
const admin = { configRevision: 7n };
// Every fixture row reads the all-zero pool: Orca tick spacing 64 @41, CLMM 60 @235, DLMM bin step 100 @80 (within the 200/300 caps).
const poolBytes = new Uint8Array(300); new DataView(poolBytes.buffer).setUint16(41, 64, true); new DataView(poolBytes.buffer).setUint16(235, 60, true);
new DataView(poolBytes.buffer).setUint16(80, 100, true);
const quality = (children: readonly V1ClassicFeed[], pool = poolBytes) => mimirV1CompositeParamRows({ programId: program, quoteMint: USDC, children,
  solFeed: { address: solFeedAddress, feed: solFeed }, pools: new Map([[bytesAddress(new Uint8Array(32)), pool]]) });

// N2S1: the SOL feed is component 0 and the converter (fix-j); the SOL-quoted child brings s = 1. 670 + 2·160 + 2·1,145 + 1,797 + 944 + 3·4 = 6,033 B.
{
  const plan = planMimirV1CompositeCreationFromFeeds({ ...accounts, children: [{ feed: solFeedAddress }, { feed: key(101), f2CreditConsumed: true }], head, colaAmountRaw: cola, admin,
    feedId: key(35), params: params(2), childFeeds: [solFeed, solQuoted], solFeed: { address: solFeedAddress, feed: solFeed }, quality: await quality([solFeed, solQuoted]) });
  assert.deepEqual(plan.shape, { s: 1, solFeed: solFeedAddress, finalLen: 6_033 });
  assert.equal(plan.instructions.length, 1);
  const ix = plan.instructions[0]!;
  assert.deepEqual([...ix.data], wire(2));
  assert.deepEqual(metas(ix), [...fixedMetas, [solFeedAddress, false, false], [key(101), false, true], [solFeedAddress, false, false]]);
}

// N5S1: one SOL-quoted child, four USDC children (Orca, CPMM → derived spot row, DLMM, DAMM v2), all compact M0: 670 + 800 + 5,725 + 2,741 + 6·4 = 9,960 B.
{
  const usdc = [feed(key(102), 3, USDC, { d: { adapterType: 0 } }), feed(key(103), 4, USDC, { d: { adapterType: 2, temporalKind: 1, bindingVersion: 0, derived: false, bindingWidth: 7 } }),
    feed(key(104), 5, USDC, { d: { adapterType: 3 } }), feed(key(105), 6, USDC, { d: { adapterType: 7 } })];
  const children = [solQuoted, ...usdc];
  const plan = planMimirV1CompositeCreationFromFeeds({ ...accounts, children: children.map((f) => ({ feed: f.selfAddress })), head, colaAmountRaw: cola, admin,
    feedId: key(35), params: params(5), childFeeds: children, solFeed: { address: solFeedAddress, feed: solFeed }, quality: await quality(children) });
  assert.deepEqual(plan.shape, { s: 1, solFeed: solFeedAddress, finalLen: 9_960 });
  assert.deepEqual([...plan.instructions[0]!.data], wire(5));
  assert.deepEqual(metas(plan.instructions[0]!), [...fixedMetas, ...children.map((f) => [f.selfAddress, false, false]), [solFeedAddress, false, false]]);
  // A non-derived Orca row keeps its 4 + 65·4 membership; an MTP4 row makes every row FULL and adds its module.
  const orcaFull = feed(key(102), 3, USDC, { d: { adapterType: 0, bindingVersion: 0, derived: false } });
  assert.equal(mimirV1CompositeShape({ quoteMint: USDC, children: [solQuoted, orcaFull], solFeed: { address: solFeedAddress, feed: solFeed } }).finalLen, 6_033 + 260);
  const sampled = feed(key(106), 7, USDC, { d: { adapterType: 4, temporalKind: 4, bindingVersion: 0, derived: false } });
  const big = mimirV1CompositeShape({ quoteMint: USDC, children: [solQuoted, sampled], solFeed: { address: solFeedAddress, feed: solFeed } });
  assert.equal(big.finalLen, 670 + 320 + 2 * 1_589 + 2_741 + 4 + 264 + 4 + 1_280);
}

// s = 0 without a SOL-quoted child, even with a SOL feed passed; refusals.
{
  const a = feed(key(102), 3, USDC); const b = feed(key(104), 5, USDC, { d: { adapterType: 3 } });
  assert.deepEqual(mimirV1CompositeShape({ quoteMint: USDC, children: [a, b], solFeed: { address: solFeedAddress, feed: solFeed } }), { s: 0, finalLen: 3_288 });
  const s0 = planMimirV1CompositeCreationFromFeeds({ ...accounts, children: [{ feed: key(102) }, { feed: key(104) }], head, colaAmountRaw: cola, admin, feedId: key(35),
    params: params(2), childFeeds: [a, b], solFeed: { address: solFeedAddress, feed: solFeed }, quality: await quality([a, b]) });
  assert.equal(s0.instructions[0]!.data[4], 0); assert.equal(s0.instructions[0]!.accounts.length, 13);
  assert.throws(() => mimirV1CompositeShape({ quoteMint: USDC, children: [a, solQuoted] }), /needs the SOL feed/);
  assert.throws(() => mimirV1CompositeShape({ quoteMint: USDC, children: [a, feed(key(107), 8, key(901))] }), /neither the composite quote nor SOL/);
  assert.throws(() => mimirV1CompositeShape({ quoteMint: USDC, children: [a, feed(key(108), 9, USDC, { n: 2 })] }), /one-row Classic/);
  assert.throws(() => mimirV1CompositeShape({ quoteMint: USDC, children: [a, solQuoted], solFeed: { address: key(109), feed: feed(key(109), 10, key(901), { base: MIMIR_V1_NATIVE_MINT, d: { adapterType: 1, mode: 2 } }) } }), /SOL feed/);
  assert.throws(() => mimirV1CompositeShape({ quoteMint: USDC, children: [a, solQuoted], solFeed: { address: solFeedAddress, feed: feed(solFeedAddress, 1, USDC, { base: MIMIR_V1_NATIVE_MINT, d: { adapterType: 0, mode: 1 } }) } }), /converter/i);
  const qualityBA = await quality([b, a]);
  assert.throws(() => planMimirV1CompositeCreationFromFeeds({ ...accounts, children: [{ feed: key(104) }, { feed: key(102) }], head, colaAmountRaw: cola, admin, feedId: key(35),
    params: params(2), childFeeds: [b, a], quality: qualityBA }), /ascending/);
  // The guard runs before anything is built: a 400-tick CLMM row above the 300 bps index spread cap; mismatched quality rows.
  const wide = new Uint8Array(poolBytes); new DataView(wide.buffer).setUint16(235, 400, true);
  const clmm = feed(key(110), 11, USDC, { d: { adapterType: 1 } });
  const qualityWide = await quality([a, clmm], wide);
  assert.throws(() => planMimirV1CompositeCreationFromFeeds({ ...accounts, children: [{ feed: key(102) }, { feed: key(110) }], head, colaAmountRaw: cola, admin, feedId: key(35),
    params: params(2), childFeeds: [a, clmm], quality: { rows: [] } }), /quality rows/);
  assert.throws(() => planMimirV1CompositeCreationFromFeeds({ ...accounts, children: [{ feed: key(102) }, { feed: key(110) }], head, colaAmountRaw: cola, admin, feedId: key(35),
    params: params(2), childFeeds: [a, clmm], quality: qualityWide }),
    (e: unknown) => e instanceof Error && /COMPOSITE_QUALITY_INCOMPATIBLE:Component 2 \(raydium-clmm 1{32}\) has a 400 bps source spread; this basket allows 300 bps \(maxComponentDispersionBps\)/.test(e.message));
}
// feed_id: with a SOL-quoted child the SOL feed's row-0 SourceConfig address is part of the identity (cfc sol_conversion_source_config).
{
  const q = 1n << 64n; const id = (f: V1ClassicFeed) => bytesAddress(f.feedId);
  const sc = async (f: V1ClassicFeed) => (await findMimirV1SourceConfigAddress(program, id(f), 0))[0];
  const components = [{ feedId: id(solFeed), sourceConfig: await sc(solFeed), quantityX64: q }, { feedId: id(solQuoted), sourceConfig: await sc(solQuoted), quantityX64: q }];
  const got = await deriveMimirV1CompositeFeedIdFromFeeds({ programId: program, creator: key(10), quoteMint: USDC, priceExponent: -8,
    children: [solFeed, solQuoted].map((feed) => ({ feed, quantityX64: q })), solFeed });
  assert.equal(got, await deriveMimirV1CompositeFeedId({ creator: key(10), quoteMint: USDC, priceExponent: -8, components, solConversionSourceConfig: await sc(solFeed) }));
  assert.notEqual(got, await deriveMimirV1CompositeFeedId({ creator: key(10), quoteMint: USDC, priceExponent: -8, components }));
  await assert.rejects(deriveMimirV1CompositeFeedIdFromFeeds({ programId: program, creator: key(10), quoteMint: USDC, priceExponent: -8,
    children: [solFeed, solQuoted].map((feed) => ({ feed, quantityX64: q })) }), /needs the SOL feed/);
}
console.log("v1 composite converter: N2S1 6,033 B, N5S1 9,960 B, byte-exact");
