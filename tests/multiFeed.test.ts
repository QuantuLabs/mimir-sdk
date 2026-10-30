import { readMimirBetaAccountCohort } from "../src/beta/rpc.js";
import { getMultipleAccountsInfoAndContextChunked, getMultipleAccountsInfoChunked } from "../src/chunkedAccounts.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { address, type Address } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import {
  MIMIR_BETA_PROPOSAL_OFFSETS, assertMimirBetaStateTuple, deriveMimirBetaClassicFeedId, deriveMimirBetaFeedPdas,
  encodeMimirBetaIdentityProposalData, readMimirBetaProposalVariant, recoverMimirBetaFeedVariant,
} from "../src/beta/abi.js";
import { findFreeMimirBetaFeedVariant, isMimirBetaVariantOccupied, deriveMimirBetaVariantFinalPdas, listMimirBetaPairFeeds,
  findMimirBetaFeedsByPool, fetchMimirBetaIndexerPairFeeds } from "../src/beta/pairFeeds.js";
import { deriveMimirBetaPda } from "../src/beta/abi.js";
import { TEST_FEED_ID, buildTestFeedId } from "../src/fixtures.js";
import { canonicalMintPairFeedId, deriveMintPairFeedId, recoverMintPairFeedVariant } from "../src/mintOracle.js";

type V = { variant: number; preimage_hex: string; feed_id_hex: string; r8_program: string; feed_config: string; feed_snapshot: string;
  sourcing_plan_0_0: string; feed_twap_0: string; feed_collateral_lock: string };
const file = JSON.parse(readFileSync(new URL("./fixtures/multiFeed/VECTORS.json", import.meta.url), "utf8")) as { vectors: V[] };
const b58 = (bytes: Uint8Array) => new PublicKey(bytes).toBase58() as Address;
for (const v of file.vectors) {
  const pre = Buffer.from(v.preimage_hex, "hex");
  const base = pre.subarray(pre.length - 64, pre.length - 32), quote = pre.subarray(pre.length - 32);
  assert.equal(canonicalMintPairFeedId(new PublicKey(base), new PublicKey(quote), v.variant).toString("hex"), v.feed_id_hex);
  const feedId = await deriveMimirBetaClassicFeedId(b58(base), b58(quote), v.variant);
  assert.equal(Buffer.from(new PublicKey(feedId).toBytes()).toString("hex"), v.feed_id_hex);
  const pdas = await deriveMimirBetaFeedPdas({ programId: address(v.r8_program), feedId });
  assert.deepEqual([pdas.feed[0], pdas.snapshot[0], pdas.sourcingPlan[0], pdas.twap[0], pdas.collateralLock[0]],
    [v.feed_config, v.feed_snapshot, v.sourcing_plan_0_0, v.feed_twap_0, v.feed_collateral_lock]);
  assert.deepEqual(await deriveMimirBetaVariantFinalPdas(address(v.r8_program), b58(base), b58(quote), v.variant),
    [v.feed_config, v.sourcing_plan_0_0, v.feed_twap_0, v.feed_snapshot, v.feed_collateral_lock]);
  assert.equal(recoverMimirBetaFeedVariant(b58(base), b58(quote), feedId), v.variant);
  assert.equal(recoverMintPairFeedVariant(new PublicKey(base), new PublicKey(quote), Buffer.from(v.feed_id_hex, "hex")), v.variant);
}
const sol = new PublicKey("So11111111111111111111111111111111111111112"), usdc = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
assert.equal(deriveMintPairFeedId({ mintAddress: sol, quoteMintAddress: usdc, cluster: "mainnet" as never, variant: 4242 }).toString("hex"),
  file.vectors.find(v => v.variant === 4242)!.feed_id_hex);
assert.throws(() => deriveMintPairFeedId({ mintAddress: sol, quoteMintAddress: usdc, cluster: "mainnet" as never, variant: 1, namespace: "x" }),
  /MintOracleVariantWithNamespace/);
assert.equal(recoverMimirBetaFeedVariant(b58(sol.toBytes()), b58(usdc.toBytes()), b58(new Uint8Array(32).fill(1))), null);

const init = { baseMint: b58(sol.toBytes()), quoteMint: b58(usdc.toBytes()), sourceSetRoot: new Uint8Array(32).fill(1), staticAccountsRoot: new Uint8Array(32).fill(2),
  anchorPolicyHash: new Uint8Array(32).fill(3), nativeExceptionHash: new Uint8Array(32).fill(4), adapterMask: 1n, namespaceVersion: 1, planId: 0, planVersion: 0,
  hashSchemeVersion: 1, ringVersion: 1, profile: 0, riskTier: 0, sourceCount: 1, minSources: 1, minVenues: 1, minCorrelationGroups: 1, baseDecimals: 9,
  quoteDecimals: 6, bindingVariants: [0, 0, 0, 0, 0], priceExponent: -8, maxDispersionBps: 100, maxSourceActivityAgeSlots: 150, minCoverageRatioBps: 10_000,
  maxConfidenceBps: 100, maxSnapshotAgeSlots: 150 } as never;
const asset = b58(new Uint8Array(32).fill(9));
const mode2 = encodeMimirBetaIdentityProposalData(init, asset), mode3 = encodeMimirBetaIdentityProposalData(init, asset, 4242);
assert.deepEqual([mode2.length, mode2[1], mode3.length, mode3[1], mode3[270], mode3[271]], [270, 2, 272, 3, 0x92, 0x10]);
assert.deepEqual(mode3.subarray(2, 270), mode2.subarray(2, 270));
assert.deepEqual(encodeMimirBetaIdentityProposalData(init, asset, 0), mode2);

const proposal = (version: 0 | 1, variant: number) => {
  const d = new Uint8Array(608 + 392); const view = new DataView(d.buffer);
  view.setUint16(8, version, true); view.setUint16(10, 608, true);
  if (version === 1) d.fill(7, 464, 496);
  view.setUint16(496, variant, true);
  for (const o of [512, 520, 528, 536]) view.setBigUint64(o, 1n, true);
  d.fill(5, 544, 608);
  return d;
};
const ok = (d: Uint8Array) => { try { assertMimirBetaStateTuple({ kind: "proposal", data: d, sourceCount: 1 }); return true; } catch { return false; } };
assert.deepEqual(MIMIR_BETA_PROPOSAL_OFFSETS, { identityAsset: [464, 496], variant: 496, reservedTail: [498, 512] });
assert.ok(ok(proposal(0, 0)) && ok(proposal(1, 0)) && ok(proposal(1, 4242)) && ok(proposal(1, 65535)));
assert.equal(readMimirBetaProposalVariant(proposal(1, 4242)), 4242);
assert.ok(!ok(proposal(0, 1)) && !ok(proposal(0, 4242)));
for (let i = 498; i < 512; i++) { const d = proposal(1, 4242); d[i] = 1; assert.ok(!ok(d), `tail ${i}`); }
{ const d = proposal(1, 0); d.fill(0, 464, 496); assert.ok(!ok(d)); }

const programId = address(file.vectors[0]!.r8_program);
const system = "11111111111111111111111111111111";
const rpcWith = (occupied: (a: Address) => object | null, calls: { reads: number; addresses: number } = { reads: 0, addresses: 0 }) => ({
  getMultipleAccounts: (addresses: readonly Address[]) => {
    calls.reads += 1; calls.addresses += addresses.length;
    return { send: async () => ({ context: { slot: 10n }, value: addresses.map(occupied) }) };
  },
}) as never;
const acct = (owner: string, len: number, lamports = 1n) => ({ owner, executable: false, lamports, data: [Buffer.alloc(len).toString("base64"), "base64"] });
const pair = { programId, baseMint: b58(sol.toBytes()), quoteMint: b58(usdc.toBytes()) };
const v1Pdas = new Set(await deriveMimirBetaVariantFinalPdas(programId, pair.baseMint, pair.quoteMint, 1));
assert.equal(await isMimirBetaVariantOccupied({ rpc: rpcWith(() => null), ...pair, variant: 1 }), false);
assert.equal(await isMimirBetaVariantOccupied({ rpc: rpcWith(a => (v1Pdas.has(a) ? acct(system, 0, 5_000_000n) : null)), ...pair, variant: 1 }), false);
for (const pda of v1Pdas) {
  assert.equal(await isMimirBetaVariantOccupied({ rpc: rpcWith(a => (a === pda ? acct(system, 1) : null)), ...pair, variant: 1 }), true);
  assert.equal(await isMimirBetaVariantOccupied({ rpc: rpcWith(a => (a === pda ? acct(programId, 357) : null)), ...pair, variant: 1 }), true);
}
const seq = (values: number[]) => { let i = 0; return () => values[i++ % values.length]!; };
const calls = { reads: 0, addresses: 0 };
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: rpcWith(a => (v1Pdas.has(a) ? acct(programId, 1) : null), calls), ...pair, allowV0: false,
  randomU16: seq([0, 1, 7, 9, 11, 13, 15, 17, 19]) }), 7);
assert.deepEqual(calls, { reads: 1, addresses: 40 });
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: rpcWith(() => null), ...pair, allowV0: true, randomU16: seq([3, 4, 5, 6, 7, 8, 9, 10]) }), 0);
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: rpcWith(() => null), ...pair, allowV0: false, randomU16: seq([3, 4, 5, 6, 7, 8, 9, 10]),
  preferProposalFree: v => v === 6 }), 6);
await assert.rejects(findFreeMimirBetaFeedVariant({ rpc: rpcWith(() => acct(programId, 1)), ...pair, allowV0: false, randomU16: seq([3, 4, 5, 6, 7, 8, 9, 10]) }),
  (e: any) => e?.code === "VARIANT_UNAVAILABLE");
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: rpcWith(() => null), ...pair, allowV0: false, indexerOccupied: [1, 2], randomU16: seq([1, 2, 3]) }), 3);
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: rpcWith(() => null), ...pair, allowV0: true, indexerOccupied: [0], randomU16: seq([7]) }), 0,
  "a stale indexer v0 row never replaces the authoritative v0 check");
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: rpcWith(() => null), ...pair, allowV0: true,
  indexerOccupied: Array.from({ length: 65535 }, (_, v) => v), randomU16: seq([65535]) }), 0, "saturated advisory set still checks v0");
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: rpcWith(() => null), ...pair, allowV0: false,
  indexerOccupied: Array.from({ length: 65536 }, (_, v) => v), randomU16: seq([5, 6, 7, 8, 9, 10, 11, 12]) }), 5,
  "an exhausted advisory complement falls back to the authoritative draw");
assert.deepEqual(buildTestFeedId(), TEST_FEED_ID);
assert.equal(recoverMintPairFeedVariant(new PublicKey(Buffer.alloc(32, 10)), usdc, buildTestFeedId(4242)), 4242);

// Realistic program-owned accounts: classic feed configs at their PDAs and a source config bound to a pool.
const classicConfig = (feedId: Address, version: 0 | 1, riskTier: number, minSources: number) => {
  const d = new Uint8Array(version === 1 ? 357 : 325); const view = new DataView(d.buffer);
  d.set(Buffer.from("MIMIRCFG")); view.setUint16(8, version, true); view.setUint16(10, d.length, true);
  d.set(new PublicKey(feedId).toBytes(), 16); d.set(sol.toBytes(), 48); d.set(usdc.toBytes(), 80);
  d[116] = riskTier; d[117] = 3; d[118] = 9; d[119] = 6; d[120] = minSources; d[121] = 1; d[122] = 1; d[312] = 255;
  if (version === 1) d.fill(9, 325, 357);
  return d;
};
const accounts = new Map<Address, { owner: string; data: Uint8Array }>();
const ids = new Map<number, Address>();
for (const [variant, version, tier, minSources] of [[0, 0, 1, 1], [7, 1, 3, 1], [4242, 1, 3, 2]] as const) {
  const feedId = await deriveMimirBetaClassicFeedId(pair.baseMint, pair.quoteMint, variant); ids.set(variant, feedId);
  accounts.set((await deriveMimirBetaFeedPdas({ programId, feedId })).feed[0], { owner: programId, data: classicConfig(feedId, version, tier, minSources) });
}
const spoofAt = b58(new Uint8Array(32).fill(77)), foreignOwner = b58(new Uint8Array(32).fill(78));
accounts.set(spoofAt, { owner: programId, data: classicConfig(ids.get(7)!, 1, 3, 9) });
const foreignFeed = await deriveMimirBetaClassicFeedId(pair.baseMint, pair.quoteMint, 99);
const foreignPda = (await deriveMimirBetaFeedPdas({ programId, feedId: foreignFeed })).feed[0];
accounts.set(foreignPda, { owner: foreignOwner, data: classicConfig(foreignFeed, 1, 3, 9) });
const pool = b58(new Uint8Array(32).fill(55));
const [sourcePda] = await deriveMimirBetaPda({ programId, seed: "source_config", values: [new PublicKey(ids.get(7)!).toBytes(), Uint8Array.of(0)] });
{ const d = new Uint8Array(384); d.set(Buffer.from("MIMIRSRC")); d.set(new PublicKey(ids.get(7)!).toBytes(), 16); d.set(new PublicKey(pool).toBytes(), 136);
  accounts.set(sourcePda, { owner: programId, data: d }); accounts.set(b58(new Uint8Array(32).fill(79)), { owner: programId, data: d }); }
const gpaCalls: any[] = [];
const realRpc = {
  getMultipleAccounts: (addresses: readonly Address[]) => ({ send: async () => ({ context: { slot: 10n }, value: addresses.map((a) => {
    const entry = accounts.get(a);
    return entry ? { owner: entry.owner, executable: false, lamports: 1n, data: [Buffer.from(entry.data).toString("base64"), "base64"] } : null;
  }) }) }),
  getProgramAccounts: (_program: Address, config: any) => ({ send: async () => {
    gpaCalls.push(config);
    const size = Number(config.filters[0].dataSize);
    return [...accounts.entries()].filter(([, entry]) => entry.data.length === size).map(([pubkey]) => ({ pubkey }));
  } }),
} as never;
const lowerVariant = await (async () => { for (let v = 31; ; v++) { const id = await deriveMimirBetaClassicFeedId(pair.baseMint, pair.quoteMint, v);
  if (Buffer.compare(new PublicKey(id).toBuffer(), new PublicKey(ids.get(7)!).toBuffer()) < 0) return { v, id }; } })();
const lowerPda = (await deriveMimirBetaFeedPdas({ programId, feedId: lowerVariant.id })).feed[0];
accounts.set(lowerPda, { owner: programId, data: classicConfig(lowerVariant.id, 1, 3, 1) });
const ranked = await listMimirBetaPairFeeds({ rpc: realRpc, ...pair });
assert.deepEqual(ranked.map((feed) => feed.variant), [4242, 7, lowerVariant.v, 0], "configured source count breaks the min-source tie before feed id");
assert.deepEqual([ranked[1]!.configuredSourceCount, ranked[1]!.pools, ranked[2]!.configuredSourceCount, ranked[1]!.publication, ranked[1]!.adapterTypes], [1, [pool], 0, null, [-1]]);
accounts.delete(lowerPda); gpaCalls.length = 0;
const listed = await listMimirBetaPairFeeds({ rpc: realRpc, ...pair });
assert.deepEqual(listed.map((feed) => feed.variant), [4242, 7, 0], "SPEC 5.2 order; spoofed address and foreign owner dropped");
assert.deepEqual(gpaCalls.map((c) => Number(c.filters[0].dataSize)), [357, 325]);
assert.deepEqual(gpaCalls[0].filters.slice(1).map((f: any) => Number(f.memcmp.offset)), [0, 48, 80]);
const rows = [...accounts.keys()].map((feedConfig) => ({ feedConfig, baseMint: pair.baseMint, quoteMint: pair.quoteMint }));
const fetched = await fetchMimirBetaIndexerPairFeeds({ url: "http://indexer/", ...pair,
  fetch: (async (url: string) => { assert.equal(url, "http://indexer/internal/feeds");
    return { ok: true, json: async () => ({ success: true, data: [...rows, { feedConfig: spoofAt, baseMint: pair.quoteMint, quoteMint: pair.baseMint }] }) }; }) as never });
assert.equal(fetched.length, rows.length);
gpaCalls.length = 0;
assert.deepEqual(await listMimirBetaPairFeeds({ rpc: realRpc, ...pair, indexerFeeds: fetched }), listed);
assert.equal(gpaCalls.length, 0, "indexer path issues no getProgramAccounts");
assert.deepEqual(await findMimirBetaFeedsByPool({ rpc: realRpc, programId, pool }), [{ feedId: ids.get(7)!, sourceConfig: sourcePda, sourceIndex: 0 }]);
assert.equal(await isMimirBetaVariantOccupied({ rpc: realRpc, ...pair, variant: 4242 }), true);
assert.equal(await isMimirBetaVariantOccupied({ rpc: realRpc, ...pair, variant: 99 }), true, "foreign-owned final PDA still occupies");
assert.equal(await isMimirBetaVariantOccupied({ rpc: realRpc, ...pair, variant: 8 }), false);
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: realRpc, ...pair, allowV0: true, randomU16: seq([7, 4242, 99, 8, 9, 10, 11, 12]) }), 8);
assert.equal(await findFreeMimirBetaFeedVariant({ rpc: realRpc, ...pair, allowV0: false, indexerOccupied: listed.map((f) => f.variant),
  randomU16: seq([7, 4242, 5]) }), 5);
{ // Cohort reads chunk at 100 addresses, later chunks floored at the first chunk's slot.
  const calls: { n: number; min?: bigint }[] = [];
  const chunkRpc = (fail = false) => ({ getMultipleAccounts: (addrs: readonly Address[], config: any) => ({ send: async () => {
    if (addrs.length > 100) throw new Error("Too many inputs provided; max 100");
    calls.push({ n: addrs.length, min: config.minContextSlot });
    if (fail && calls.length === 2) throw new Error("rpc down");
    return { context: { slot: 20n }, value: addrs.map(() => null) }; } }) }) as never;
  const addrs = (n: number) => Array.from({ length: n }, (_, i) => b58(new Uint8Array(32).fill(0).map((_, j) => j < 2 ? (i >> (8 * j)) & 255 : 200)));
  const r105 = await readMimirBetaAccountCohort(chunkRpc(), addrs(105), "finalized");
  assert.equal(calls.length, 2); assert.equal(r105.value.length, 105);
  calls.length = 0; await readMimirBetaAccountCohort(chunkRpc(), addrs(100), "finalized"); assert.deepEqual(calls.map((c) => c.n), [100]);
  calls.length = 0; await assert.rejects(readMimirBetaAccountCohort(chunkRpc(true), addrs(105), "finalized"), /rpc down/);
  const slotRpc = (slots: (n: number, min?: bigint) => bigint, log: { n: number; min?: bigint }[] = [], short = false) => ({
    getMultipleAccounts: (a: readonly Address[], config: any) => ({ send: async () => {
      log.push({ n: a.length, min: config.minContextSlot });
      return { context: { slot: slots(a.length, config.minContextSlot) }, value: (short && a.length === 5 ? a.slice(1) : a).map(() => null) }; } }) }) as never;
  const log: { n: number; min?: bigint }[] = [];
  const aligned = await readMimirBetaAccountCohort(slotRpc((n, min) => min ?? (n === 100 ? 21n : 22n), log), addrs(105), "finalized");
  assert.equal(aligned.slot, 22n); assert.deepEqual(log, [{ n: 100, min: undefined }, { n: 5, min: undefined }, { n: 100, min: 22n }]);
  log.length = 0; assert.equal((await readMimirBetaAccountCohort(slotRpc(() => 40n, log), addrs(105), "finalized", 7n)).slot, 40n);
  assert.deepEqual(log.map((c) => c.min), [7n, 7n]);
  log.length = 0;
  assert.equal((await readMimirBetaAccountCohort(slotRpc((n, min) => (min ?? 50n) + (n === 100 ? 0n : 1n), log), addrs(105), "finalized")).slot, 51n);
  assert.equal(log.length, 3);
  log.length = 0;
  await assert.rejects(readMimirBetaAccountCohort(slotRpc((n, min) => (min ?? 50n) + (n === 100 ? 1n : 2n), log), addrs(105), "finalized"),
    (e: any) => e.code === "RPC_CONTEXT_MISMATCH"); assert.equal(log.length, 5);
  await assert.rejects(readMimirBetaAccountCohort(slotRpc(() => 9n, [], true), addrs(105), "finalized"), (e: any) => e.code === "RPC_CONTEXT_MISMATCH");
  const regress = { getMultipleAccounts: (a: readonly Address[]) => ({ send: async () => ({ context: { slot: a.length === 100 ? 30n : 29n }, value: a.map(() => null) }) }) } as never;
  await assert.rejects(readMimirBetaAccountCohort(regress, addrs(105), "finalized"), (e: any) => e.code === "RPC_CONTEXT_MISMATCH");
  // Generic web3 helpers: identity/order, coherent slot, short chunk.
  const keys = Array.from({ length: 205 }, (_, i) => ({ i, toBase58: () => b58(new Uint8Array(32).fill(i)) }) as never as PublicKey);
  const web3Calls: number[] = [];
  const conn = (slotOf: (first: number) => number, short = false) => ({
    getMultipleAccountsInfo: async (k: any[]) => { web3Calls.push(k.length); return (short && k.length === 5 ? k.slice(1) : k).map((x) => ({ id: x.i })); },
    getMultipleAccountsInfoAndContext: async (k: any[], c: any) => ({ context: { slot: c.minContextSlot ?? slotOf(k[0].i) },
      value: (short && k.length === 5 ? k.slice(1) : k).map((x: any) => ({ id: x.i })) }) }) as any;
  assert.deepEqual((await getMultipleAccountsInfoChunked(conn(() => 0), keys)).map((x: any) => x.id), keys.map((_, i) => i));
  assert.deepEqual(web3Calls, [100, 100, 5]);
  web3Calls.length = 0; await getMultipleAccountsInfoChunked(conn(() => 0), keys.slice(0, 100)); assert.deepEqual(web3Calls, [100]);
  await assert.rejects(getMultipleAccountsInfoChunked(conn(() => 0, true), keys), (e: any) => e.code === "RPC_CONTEXT_MISMATCH");
  const ctx = await getMultipleAccountsInfoAndContextChunked(conn((i) => 60 + i), keys, { commitment: "confirmed" });
  assert.equal(ctx.context.slot, 260); assert.deepEqual(ctx.value.map((x: any) => x.id), keys.map((_, i) => i));
  await assert.rejects(getMultipleAccountsInfoAndContextChunked(conn(() => 1, true), keys, { commitment: "confirmed" }),
    (e: any) => e.code === "RPC_CONTEXT_MISMATCH");
  // 15 feeds on one pair -> 105-address closure under an RPC enforcing max 100.
  const many = new Map<Address, { owner: string; data: Uint8Array }>();
  for (let v = 1; v <= 15; v++) { const feedId = await deriveMimirBetaClassicFeedId(pair.baseMint, pair.quoteMint, v);
    many.set((await deriveMimirBetaFeedPdas({ programId, feedId })).feed[0], { owner: programId, data: classicConfig(feedId, 1, 3, 1) }); }
  const capped = { getMultipleAccounts: (a: readonly Address[]) => ({ send: async () => {
      if (a.length > 100) throw new Error("Too many inputs provided; max 100");
      return { context: { slot: 10n }, value: a.map((x) => { const e = many.get(x);
        return e ? { owner: e.owner, executable: false, lamports: 1n, data: [Buffer.from(e.data).toString("base64"), "base64"] } : null; }) }; } }),
    getProgramAccounts: (_p: Address, config: any) => ({ send: async () => [...many.entries()]
      .filter(([, e]) => e.data.length === Number(config.filters[0].dataSize)).map(([pubkey]) => ({ pubkey })) }) } as never;
  assert.equal((await listMimirBetaPairFeeds({ rpc: capped, ...pair })).length, 15);
}
console.log("multi-feed variant tests passed");
