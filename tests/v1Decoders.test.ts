import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import type { Address } from "@solana/kit";
import {
  checkV1ConsumerPin, createV1RentReader, decodeV1ClassicFeed, decodeV1CompositeFeed, listV1ClassicFeeds, listV1Composites,
  readV1ConsumerPin, v1ClassicAccountLen, v1CompositeAccountLen, v1CreationRentLamports, V1_CONSUMER_READ_LEN,
  type V1RowShape,
} from "../src/v1/index.js";
import { MimirBetaError } from "../src/beta/errors.js";
import { computeMimirRentExemptLamports, decodeMimirRentSysvar, MIMIR_RENT_SYSVAR } from "../src/beta/rent.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/layout_v1/${name}`, import.meta.url)));
const view = (d: Uint8Array) => new DataView(d.buffer, d.byteOffset, d.byteLength);
const u16 = (d: Uint8Array, o: number) => view(d).getUint16(o, true);
const u32 = (d: Uint8Array, o: number) => view(d).getUint32(o, true);
const i32 = (d: Uint8Array, o: number) => view(d).getInt32(o, true);
const u64 = (d: Uint8Array, o: number) => view(d).getBigUint64(o, true);
const i64 = (d: Uint8Array, o: number) => view(d).getBigInt64(o, true);
const u128 = (d: Uint8Array, o: number) => u64(d, o) | (u64(d, o + 8) << 64n);
const bytes = (d: Uint8Array, o: number, n: number) => d.subarray(o, o + n);
const addr = (d: Uint8Array, o: number) => bs58.encode(bytes(d, o, 32)) as Address;
const text = (d: Uint8Array, o: number) => Buffer.from(bytes(d, o, 8)).toString("latin1");
const pat = (tag: number, n: number) => Uint8Array.from({ length: n }, (_, i) => (i % 2 === 0 ? tag : i & 0xff));
const isErr = (code: string) => (e: unknown) => e instanceof MimirBetaError && e.code === code;

// Rent is mainnet (5,080 lamports/byte-year, threshold 1, burn 50%), asserted first.
const rentData = new Uint8Array(17); view(rentData).setBigUint64(0, 5_080n, true); view(rentData).setFloat64(8, 1, true); rentData[16] = 50;
const RENT = decodeMimirRentSysvar(rentData);
assert.deepEqual(RENT, { lamportsPerByteYear: 5_080n, exemptionThreshold: 1, burnPercent: 50 });

// ---- Classic goldens: every decoded field against the literal offsets of LAYOUT_V1_CLASSIC.md §1 / §4.
for (const [name, n, s] of [["reference_usdc_cpmm_m0", 1, 0], ["sol_quoted_cpmm_m0", 1, 1]] as const) {
  const d = fixture(`classic/${name}.bin`);
  const f = decodeV1ClassicFeed(d, addr(d, 48));
  assert.equal(d.length, s === 0 ? 2506 : 5251);
  assert.deepEqual(f.prefix, bytes(d, 0, 512));
  assert.deepEqual(f.feedId, bytes(d, 16, 32));
  assert.equal(f.selfAddress, addr(d, 48));
  assert.deepEqual(f.owner, {
    generation: u64(d, 512), createdSlot: u64(d, 512) >> 20n, generationSeq: Number(u64(d, 512) & 0xfffffn),
    closeAfterSlot: u64(d, 520), noticeKind: d[528], creator: addr(d, 529),
    identityAsset: bytes(d, 561, 32).every((b) => b === 0) ? null : addr(d, 561),
  });
  assert.equal(text(d, 593), "MIMIRCLX");
  assert.deepEqual(f.header, {
    version: 2, hlen: 64, exactLen: d.length, definitionDigest: bytes(d, 609, 32), sourceSetRevision: u64(d, 641),
    n, s, bump: d[651], status: d[652], regionMask: 0, f2Credit: d[654],
  });
  const ev = (o: number) => ({
    wireAge: u16(d, o), configured: d[o + 2], k: d[o + 3], effectiveK: d[o + 4], venues: d[o + 5], correlations: d[o + 6], flags: d[o + 7],
    minRingSlot: u64(d, o + 8), quietLastRefresh: i64(d, o + 16), quietEnd: i64(d, o + 24), quietEndSlot: u64(d, o + 32),
    quietWidthBps: u16(d, o + 40), sampledBandBps: u16(d, o + 42), sampledCloseBps: u16(d, o + 44), supportStart: i64(d, o + 48),
    supportEnd: i64(d, o + 56), floor: u128(d, o + 64),
  });
  assert.equal(text(d, 657), "MIMIRCPR");
  assert.deepEqual(f.proof, {
    version: u16(d, 665), len: 256, flags: u32(d, 669), revision: u64(d, 673), slot: u64(d, 681), primary: ev(689), converter: ev(769),
    converterRevision: u64(d, 849), converterSlot: u64(d, 857), converterValidUntil: u64(d, 865), converterFeedId: bytes(d, 873, 32),
    dual: bytes(d, 905, 4),
  });
  assert.deepEqual(f.definition, { feedImage: bytes(d, 913, 325), planImage: bytes(d, 1238, 320), ticker: bytes(d, 1226, 12) });
  assert.equal(text(d, 913), "MIMIRCFG");
  const desc = (o: number) => ({
    minSlotGap: u16(d, o), externalWidth: d[o + 2], temporalKind: d[o + 3], moduleOffset: u32(d, o + 4), moduleLen: u16(d, o + 8),
    mode: d[o + 10], requiresIxSysvar: d[o + 11], adapterType: d[o + 12], adapterVersion: d[o + 13], bindingWidth: d[o + 14],
    bindingVersion: d[o + 15], derived: (d[o + 15]! & 2) !== 0,
  });
  const row = (o: number) => ({ descriptor: desc(o), source: bytes(d, o + 16, 384), ring: bytes(d, o + 400, 544) });
  assert.deepEqual(f.rows, [row(1558)]);
  assert.equal(text(d, 1574), "MIMIRSRC");
  assert.equal(text(d, 1958), "MIMIRRNG");
  const memb = (o: number) => ({ bindingWidth: d[o], planBinding: d[o + 1], bindingVariant: d[o + 2], derived: d[o + 3] === 1, tuples: [] });
  if (s === 0) {
    assert.equal(f.converter, null);
    assert.deepEqual(f.memberships, [memb(2502)]);
  } else {
    assert.deepEqual(f.converter, {
      definition: { feedImage: bytes(d, 2502, 325), planImage: bytes(d, 2827, 320), ticker: bytes(d, 2815, 12) },
      twap: bytes(d, 3147, 640), snapshot: bytes(d, 3787, 512), rows: [row(4299)],
    });
    assert.equal(text(d, 3147), "MIMIRTWP");
    assert.equal(text(d, 3787), "MIMIRSNP");
    assert.deepEqual(f.memberships, [memb(5243), memb(5247)]);
  }
  assert.ok(f.memberships.every((m) => m.derived));
  assert.deepEqual(f.modules, f.memberships.map(() => new Uint8Array(0)));

  // Fail closed: wrong address, exact_len, region_mask, membership marker, truncated.
  assert.throws(() => decodeV1ClassicFeed(d, addr(d, 16)), isErr("ACCOUNT_MALFORMED"));
  for (const [at, value] of [[653, 1], [605, 0], [d.length - 1, 0], [601, 3]] as const) {
    const bad = d.slice(); bad[at] = value;
    assert.throws(() => decodeV1ClassicFeed(bad), isErr("ACCOUNT_MALFORMED"), `byte @${at}`);
  }
  assert.throws(() => decodeV1ClassicFeed(d.subarray(0, d.length - 4)), isErr("ACCOUNT_MALFORMED"));

  // Proof @657: all zero (degraded publication; blank before the first Fresh tag89, rings zero too) -> null, rest unchanged.
  const degraded = d.slice(); degraded.fill(0, 657, 913);
  assert.deepEqual(decodeV1ClassicFeed(degraded, addr(d, 48)), { ...f, proof: null });
  const blank = degraded.slice(); blank.fill(0, 1958, 2502);
  if (s === 1) blank.fill(0, 3147, 4299).fill(0, 4699, 5243);
  assert.equal(decodeV1ClassicFeed(blank).proof, null);
  // A non-zero proof still needs MIMIRCPR, version 1|2 and len 256.
  for (const [at, value] of [[657, 0], [665, 3], [668, 0]] as const) {
    const bad = d.slice(); bad[at] = value;
    assert.throws(() => decodeV1ClassicFeed(bad), isErr("ACCOUNT_MALFORMED"), `proof byte @${at}`);
  }
  const stray = degraded.slice(); stray[700] = 1;
  assert.throws(() => decodeV1ClassicFeed(stray), isErr("ACCOUNT_MALFORMED"));
}

// ---- Composite goldens: every field against make_goldens.py values (LAYOUT_V1_COMPOSITE.md).
const COMPOSITES = [
  { name: "two_comp_reuse", n: 2, tag: 0x22, ticker: "MAG2", gen: (380_000_000n << 20n) | 3n, close: 0n, notice: 0, identity: null as Uint8Array | null,
    fees: [16_000n, 20_000n, 0n, 4_000n, 9n] },
  { name: "mag5", n: 5, tag: 0x23, ticker: "MAG5", gen: 380_000_500n << 20n, close: 381_512_600n, notice: 1, identity: pat(0x99, 32),
    fees: [1_600_000n, 2_000_000n, 800_000n, 400_000n, 9n] },
] as const;
for (const g of COMPOSITES) {
  const d = fixture(`composite/${g.name}.bin`);
  const children = fixture(`composite/${g.name}.children.bin`);
  const n = g.n, P = 320 + 80 * n, cfc = P + 49, hdr = cfc + 229 + 80 * n, fee = hdr + 32, rows = fee + 40, memb = rows + 1145 * n;
  assert.equal(d.length, n === 2 ? 3288 : 7215);
  const c = decodeV1CompositeFeed(d, addr(d, 48));
  assert.equal(c.prefixLen, P);
  assert.deepEqual(c.prefix, bytes(d, 0, P));
  assert.deepEqual(c.snapshot, {
    version: 0, headerLen: 720, flags: 0, feedId: pat(g.tag, 32), config: addr(d, 48), registryEpoch: 7n, configRevision: 1n, revision: 1n,
    status: 0, routeability: 4, riskTier: 0, snapshotSource: 4, freshness: 2, count: n, quoteStatus: 0,
    snapshotSlot: 380_000_100n, validUntilSlot: 380_000_250n, unixTs: 1_792_000_000n,
    oldestComponentSnapshotSlot: 380_000_090n, oldestComponentActivitySlot: 380_000_080n,
    priceMantissa: 123_456_789n, priceExponent: -8, confidenceBps: 45, dispersionBps: 12,
    priceX64: 0x0123456789ABCDEF0011223344556677n, priceLowerX64: 0x0123456789ABCDEF0011223344550000n,
    priceUpperX64: 0x0123456789ABCDEF00112233445599FFn, maxRecommendedNotional: 5_000_000_000n, manipulationCostFloor: 7_000_000n,
    componentSetHash: pat(0x55, 32), componentSnapshotHash: pat(0x66, 32), anchorProvider: 0, anchorStatus: 1, conditions: 0, powers: 0,
    conditionedRows: 0, priceState: 0,
    components: Array.from({ length: n }, (_, i) => ({
      feedId: pat(0x70 + i, 32), snapshotRevision: BigInt(10 + i), snapshotSlot: BigInt(380_000_090 + i),
      priceX64: BigInt(i + 1) << 64n, contributionX64: BigInt(i + 1) << 60n,
    })),
  });
  assert.deepEqual(c.owner, {
    generation: g.gen, createdSlot: g.gen >> 20n, generationSeq: Number(g.gen & 0xfffffn), closeAfterSlot: g.close, noticeKind: g.notice,
    creator: null, identityAsset: g.identity ? bs58.encode(g.identity) : null,
  });
  const bump = d[hdr + 25]!;
  assert.deepEqual(c.config, {
    version: 2, headerLen: 229 + 80 * n, flags: 1, feedId: pat(g.tag, 32), creator: bs58.encode(pat(0x33, 32)), quoteMint: bs58.encode(pat(0x44, 32)),
    priceExponent: -8, status: 1, routeabilityCap: 4, riskTier: 0, componentCount: n, maxSnapshotAgeSlots: 150,
    maxComponentSnapshotAgeSlots: 120, maxComponentConfidenceBps: 200, maxComponentDispersionBps: 300, componentSetHash: pat(0x55, 32),
    registryEpoch: 7n, configRevision: 1n, adminRevisionAtCreation: 4n, bump,
    ticker: Uint8Array.from([...Buffer.from(g.ticker), ...new Uint8Array(12 - g.ticker.length)]), solConversionSourceConfig: null,
    components: Array.from({ length: n }, (_, i) => ({ feedId: pat(0x70 + i, 32), sourceConfig: bs58.encode(pat(0x80 + i, 32)), quantityX64: BigInt(i + 1) << 64n })),
  });
  assert.deepEqual(c.header, { version: 3, hlen: 32, exactLen: d.length, cfcRevision: 1n, count: n, bump, status: 1, converterCount: 0, regionMask: 0, rowFormat: 0 });
  assert.deepEqual(c.fees, {
    ownerGenerated: g.fees[0], totalRefreshFees: g.fees[1], ownerClaimed: g.fees[2], treasuryPaid: g.fees[3],
    lastAccrualConfigRevision: g.fees[4], ownerLiability: g.fees[0] - g.fees[2],
  });
  assert.equal(c.rows.length, n);
  c.rows.forEach((row, i) => {
    const r = rows + 1145 * i;
    assert.deepEqual(row.descriptor, {
      minSlotGap: 2, externalWidth: 5, temporalKind: 0, moduleOffset: 0, moduleLen: 0, mode: 6, requiresIxSysvar: 0, adapterType: 2,
      adapterVersion: 0, bindingWidth: 4, bindingVersion: 3, derived: true,
    });
    assert.deepEqual(row.source, pat(0xa0 + i, 384));
    assert.deepEqual(row.ring, pat(0xe0 + i, 544));
    assert.equal(row.feedImage, null);
    assert.equal(row.planImage, null);
    const feed = bytes(children, 645 * i, 325), plan = bytes(children, 645 * i + 325, 320);
    // T3: stored tag == sha256("MIMIR_FRONTIER_BIND_V1" ‖ feed ‖ plan)[..8]; RowDef runs invert to the child images.
    const tag = createHash("sha256").update("MIMIR_FRONTIER_BIND_V1").update(feed).update(plan).digest().subarray(0, 8);
    assert.deepEqual(row.rowDef, {
      priceExponent: i32(feed, 112), riskTier: feed[116], lifecycleState: feed[117], baseDecimals: feed[118], quoteDecimals: feed[119],
      minSourceCount: feed[120], minVenueCount: feed[121], minCorrelationGroupCount: feed[122],
      minCoverageRatioBps: u16(feed, 124), maxConfidenceBps: u16(feed, 126), maxDispersionBps: u16(feed, 128),
      maxSnapshotAgeSlots: u16(feed, 130), maxSourceActivityAgeSlots: u16(feed, 132), sourceSetHash: bytes(feed, 136, 32),
      anchorPolicyHash: bytes(feed, 232, 32), nativeExceptionHash: bytes(feed, 264, 32), feedConfigRevision: u64(feed, 296),
      registryEpoch: u64(feed, 304), feedBump: feed[312], planHash: bytes(plan, 196, 32), planId: u16(plan, 48), planVersion: u16(plan, 50),
      planProfile: plan[52], planStatus: plan[53], planRiskTier: plan[54], planMinSources: plan[55], planMinVenues: plan[56],
      planMinCorrelationGroups: plan[57], planMaxDispersionBps: u16(plan, 58), planMaxSourceActivityAgeSlots: u16(plan, 60),
      adapterMask: u64(plan, 292), planBump: plan[300], hashSchemeVersion: plan[301], ringVersion: u16(plan, 302),
      accountsBindingVersion: plan[304], bindTag: new Uint8Array(tag),
    });
    assert.equal(row.rowDef!.priceExponent, -6);
    assert.equal(row.rowDef!.feedConfigRevision, BigInt(40 + i));
    assert.deepEqual(bytes(d, r + 400 + 193, 8), new Uint8Array(tag));
  });
  assert.equal(c.converter, null);
  assert.deepEqual(c.memberships, Array.from({ length: n }, () => ({ bindingWidth: 4, planBinding: 1, bindingVariant: 0, derived: true, tuples: [] })));
  assert.equal(memb + 4 * n, d.length);
  assert.equal(c.dualProof, null);

  for (const [at, value] of [[109, 6], [hdr + 28, 1], [hdr + 29, 1], [fee + 16, 0xff], [cfc + 197, 1], [memb + 3, 0]] as const) {
    const bad = d.slice(); bad[at] = value; if (at === fee + 16) bad.fill(0xff, at, at + 8);
    assert.throws(() => decodeV1CompositeFeed(bad), isErr("ACCOUNT_MALFORMED"), `byte @${at}`);
  }
  assert.throws(() => decodeV1CompositeFeed(d, addr(d, 16)), isErr("ACCOUNT_MALFORMED"));

  // B11 blank image: CSP never published (revision 0) and rings zero still decode.
  const blankCsp = d.slice(); blankCsp.fill(0, 96, 104);
  for (let i = 0; i < n; i++) blankCsp.fill(0, rows + 1145 * i + 601, rows + 1145 * (i + 1));
  assert.equal(decodeV1CompositeFeed(blankCsp).snapshot.revision, 0n);

  // DUAL row 0 (temporal kind 6): the 64 + 84N proof is zero until the first tag87 -> null; stamped -> decoded.
  const dualLen = 64 + 84 * n;
  const dual = new Uint8Array(d.length + dualLen); dual.set(d); dual[rows + 3] = 6;
  view(dual).setUint32(hdr + 12, dual.length, true);
  assert.equal(decodeV1CompositeFeed(dual).dualProof, null);
  const stamped = dual.slice(); stamped.set(Buffer.from("MIMIRCDP"), d.length);
  view(stamped).setUint16(d.length + 8, 2, true); view(stamped).setUint16(d.length + 10, dualLen, true);
  assert.deepEqual(decodeV1CompositeFeed(stamped).dualProof?.len, dualLen);
  for (const [at, value] of [[0, 0], [8, 1], [10, 0]] as const) {
    const bad = stamped.slice(); bad[d.length + at] = value;
    assert.throws(() => decodeV1CompositeFeed(bad), isErr("ACCOUNT_MALFORMED"), `DUAL proof byte +${at}`);
  }
}

// ---- Exact byte table and live-rent lamports (LAYOUT rent tables).
const M0 = (temporalKind = 0): V1RowShape => ({ derived: true, bindingWidth: 4, temporalKind });
const FULL = (temporalKind = 0): V1RowShape => ({ derived: false, bindingWidth: 4, temporalKind });
assert.equal(v1ClassicAccountLen({ primaries: [M0()] }), 2506);
assert.equal(v1ClassicAccountLen({ primaries: [M0()], converters: [M0()] }), 5251);
assert.equal(v1ClassicAccountLen({ primaries: [FULL(4)] }), 4046);
assert.equal(v1CompositeAccountLen({ components: [M0(), M0()] }), 3288);
assert.equal(v1CompositeAccountLen({ components: [M0(), M0(), M0()] }), 4597);
assert.equal(v1CompositeAccountLen({ components: Array(5).fill(M0()) }), 7215);
assert.deepEqual([2, 3, 5].map((n) => v1CompositeAccountLen({ components: Array(n).fill(FULL()) })), [3808, 5377, 8515]);
assert.equal(v1CompositeAccountLen({ components: [FULL(4), M0()] }), 670 + 160 * 2 + 1589 * 2 + 264 + 4 + 1280);
assert.equal(v1CompositeAccountLen({ components: [M0(6), M0()], converters: [M0()] }), 670 + 320 + 1145 * 2 + 1797 + 944 + 12 + 64 + 168 + 56);
assert.throws(() => v1CompositeAccountLen({ components: Array(6).fill(M0()) }), RangeError);
assert.throws(() => v1ClassicAccountLen({ primaries: [] }), RangeError);
assert.deepEqual(v1CreationRentLamports(RENT, 2506), { account: 13_380_720n, tickerClaim: 868_680n, total: 14_249_400n });
assert.equal(v1CreationRentLamports(RENT, 5251).account, 27_325_320n);
assert.deepEqual([3288, 4597, 7215].map((len) => computeMimirRentExemptLamports(RENT, len)), [17_353_280n, 24_003_000n, 37_302_440n]);
assert.deepEqual([16, 32].map((len) => computeMimirRentExemptLamports(RENT, len)), [731_520n, 812_800n]);

let rentReads = 0;
const rentRpc = { getAccountInfo: (address: string, config: object) => ({ send: async () => {
  rentReads++;
  assert.equal(address, MIMIR_RENT_SYSVAR); assert.deepEqual(config, { commitment: "finalized", encoding: "base64" });
  if (rentReads === 1) throw new Error("transient");
  return { context: { slot: 1n }, value: { data: [Buffer.from(rentData).toString("base64"), "base64"] } };
} }) } as never;
const reader = createV1RentReader(rentRpc);
await assert.rejects(reader.rent(), /transient/);
assert.equal(await reader.rentExemptLamports(2506), 13_380_720n);
assert.equal((await reader.creationRentLamports(7215)).account, 37_302_440n);
assert.equal(rentReads, 2);

// ---- Discovery: one gPA per kind, magic memcmp, owner-record dataSlice, notice decoded from the same read.
const PROGRAM = (JSON.parse(readFileSync(new URL("./fixtures/v1/abi2-mainnet-draft-manifest.json", import.meta.url), "utf8")) as { programId: Address }).programId;
const classicGold = fixture("classic/sol_quoted_cpmm_m0.bin");
const compGolds = COMPOSITES.map((g) => fixture(`composite/${g.name}.bin`));
const gpaCalls: { config: { dataSlice: { offset: number; length: number }; filters: { memcmp: { offset: bigint; bytes: string } }[] } }[] = [];
const gpaRpc = { getProgramAccounts: (programId: string, config: never) => ({ send: async () => {
  assert.equal(programId, PROGRAM);
  gpaCalls.push({ config });
  const { dataSlice, filters } = config as (typeof gpaCalls)[number]["config"];
  const accounts = filters.length === 2 ? [classicGold] : compGolds;
  return accounts.map((a) => ({ pubkey: addr(a, 48), account: { data: [Buffer.from(a.subarray(dataSlice.offset, dataSlice.offset + dataSlice.length)).toString("base64"), "base64"] } }));
} }) };
const classics = await listV1ClassicFeeds(gpaRpc, PROGRAM);
assert.deepEqual(classics, [{ kind: "classic", address: addr(classicGold, 48), owner: decodeV1ClassicFeed(classicGold).owner }]);
const composites = await listV1Composites(gpaRpc, PROGRAM);
assert.deepEqual(composites, compGolds.map((a) => ({ kind: "composite", address: addr(a, 48), owner: decodeV1CompositeFeed(a).owner })));
assert.equal(composites[1]!.owner.noticeKind, 1);
assert.deepEqual(gpaCalls.map((c) => [c.config.dataSlice, c.config.filters.map((f) => [f.memcmp.offset, Buffer.from(f.memcmp.bytes, "base64").toString()])]), [
  [{ offset: 512, length: 81 }, [[0n, "MIMIRSNP"], [593n, "MIMIRCLX"]]],
  [{ offset: 109, length: 660 }, [[0n, "MIMIRCSP"]]],
]);

// ---- Consumer pin (S3): fail closed on missing / System-owned / foreign owner / generation mismatch; notice policy.
const classicAddr = addr(classicGold, 48);
const classicGen = u64(classicGold, 512);
const pin = { programId: PROGRAM, address: classicAddr, generation: classicGen };
const ok = checkV1ConsumerPin(pin, { owner: PROGRAM, data: classicGold });
assert.deepEqual(ok, { kind: "classic", prefixLen: 512, generation: classicGen, closeAfterSlot: u64(classicGold, 520), noticeKind: classicGold[528], notice: ["none", "wind-down", "keep"][classicGold[528]!] });
assert.throws(() => checkV1ConsumerPin(pin, null), isErr("ACCOUNT_NOT_FOUND"));
assert.throws(() => checkV1ConsumerPin(pin, { owner: "11111111111111111111111111111111" as Address, data: new Uint8Array(0) }), isErr("ACCOUNT_SYSTEM_OWNED"));
assert.throws(() => checkV1ConsumerPin(pin, { owner: MIMIR_RENT_SYSVAR, data: classicGold }), isErr("ACCOUNT_OWNER_MISMATCH"));
assert.throws(() => checkV1ConsumerPin({ ...pin, generation: classicGen + 1n }, { owner: PROGRAM, data: classicGold }), isErr("GENERATION_MISMATCH"));
assert.throws(() => checkV1ConsumerPin({ ...pin, address: addr(compGolds[0]!, 48) }, { owner: PROGRAM, data: classicGold }), isErr("ACCOUNT_MALFORMED"));
assert.throws(() => checkV1ConsumerPin(pin, { owner: PROGRAM, data: classicGold.subarray(0, 528) }), isErr("ACCOUNT_MALFORMED"));
for (const [i, g] of COMPOSITES.entries()) {
  const a = compGolds[i]!;
  const P = 320 + 80 * g.n;
  const v = checkV1ConsumerPin({ programId: PROGRAM, address: addr(a, 48), generation: g.gen }, { owner: PROGRAM, data: a.subarray(0, P + 17) });
  assert.deepEqual(v, { kind: "composite", prefixLen: P, generation: g.gen, closeAfterSlot: g.close, noticeKind: g.notice, notice: g.notice === 1 ? "wind-down" : "none" });
}
const abandoned = compGolds[1]!.slice(); abandoned[720 + 16] = 2;
assert.equal(checkV1ConsumerPin({ programId: PROGRAM, address: addr(abandoned, 48), generation: COMPOSITES[1].gen }, { owner: PROGRAM, data: abandoned }).notice, "keep");
assert.equal(V1_CONSUMER_READ_LEN, 737);
const pinRpc = (value: unknown) => ({ getAccountInfo: (address: string, config: object) => ({ send: async () => {
  assert.equal(address, classicAddr);
  assert.deepEqual(config, { commitment: "confirmed", encoding: "base64", dataSlice: { offset: 0, length: 737 } });
  return { context: { slot: 1n }, value };
} }) }) as never;
assert.equal((await readV1ConsumerPin(pinRpc({ owner: PROGRAM, data: [Buffer.from(classicGold.subarray(0, 737)).toString("base64"), "base64"] }), pin)).generation, classicGen);
await assert.rejects(readV1ConsumerPin(pinRpc(null), pin), isErr("ACCOUNT_NOT_FOUND"));

console.log("v1Decoders ok");
