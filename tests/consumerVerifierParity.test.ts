import assert from "node:assert/strict";
import { PublicKey } from "@solana/web3.js";
import { assessMimirRefresh, verifyMimirPublicationForConsumer, type MimirConsumerReaderPolicy } from "../src/beta/refreshPlanner.js";
import { decodeMimirBetaLivePlan } from "../src/beta/liveAbi.js";
import { mimirBetaHashv } from "../src/beta/abi.js";
import { buildTestFeedConfigHeader, buildTestSnapshotHeader, buildTestSourcingPlanHeader, defaultTestSnapshotPolicy, TEST_FEED_ID, TEST_PLAN_HASH } from "../src/fixtures.js";
import { decodeFeedSnapshotHeader, decodeLifecycleFeedConfigHeader, verifyFeedConfigForSnapshot, verifySnapshotHeader } from "../src/codec.js";
import { createMimirRefreshGroupBuilder } from "../src/refreshGroup.js";
import { initialMimirSampledReadiness } from "../src/internal/sampledTemporalCore.js";

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u64 = (b: Uint8Array, o: number, v: bigint) => dv(b).setBigUint64(o, v, true);
const u16 = (b: Uint8Array, o: number, v: number) => dv(b).setUint16(o, v, true);
const u128 = (b: Uint8Array, o: number, v: bigint) => { u64(b, o, v & ((1n << 64n) - 1n)); u64(b, o + 8, v >> 64n); };
const config = () => { const b = new Uint8Array(357); b.set(buildTestFeedConfigHeader()); u16(b, 8, 1); u16(b, 10, 357); b.fill(8, 325, 357); return b; };
const snapshot = () => {
  const b = new Uint8Array(buildTestSnapshotHeader()); b[107] = 2;
  const price = dv(b).getBigUint64(200, true);
  u128(b, 216, price * 9985n / 10000n); u128(b, 232, (price * 10015n + 9999n) / 10000n); return b;
};
const canonical = (fn: () => void) => { try { fn(); return "accepted"; } catch (e) { return (e as Error).message; } };
const policy = defaultTestSnapshotPolicy();
const reader: MimirConsumerReaderPolicy = { expectedRouteabilityStatus: policy.expectedRouteabilityStatus, maxConfidenceBps: policy.maxConfidenceBps,
  maxDispersionBps: policy.maxDispersionBps, notional: policy.notional, minSourceCount: policy.minSourceCount, minVenueCount: policy.minVenueCount,
  minCorrelationGroupCount: policy.minCorrelationGroupCount, minCoverageRatioBps: policy.minCoverageRatioBps, flags: policy.flags,
  expectedNativeExceptionHash: policy.expectedNativeExceptionHash };
const check = { account: "11111111111111111111111111111111", config: "11111111111111111111111111111112", kind: "classic-snapshot", slotOffset: 116,
  revisionOffset: 96, statusOffset: 104, expectedStatus: 0, validUntilSlotOffset: 124, snapshotSourceOffset: 107, expectedSnapshotSource: 2,
  capModelVersionOffset: 420, expectedCapModelVersion: 2 } as const;
const expected = { feedId: TEST_FEED_ID, configRevision: 1n, priceExponent: -8, planHash: TEST_PLAN_HASH, revision: 1n };
const verify = (data: Uint8Array, cfg = config(), readerPolicy: MimirConsumerReaderPolicy = reader) =>
  verifyMimirPublicationForConsumer({ data, config: cfg, check: check as never, clockSlot: 101n, maxPublicationAgeSlots: 5, expected, readerPolicy });

// Consumer verifier mirrors the canonical feed-config and reader predicates.
{
  const base = snapshot();
  assert.equal(verify(base).ok, true);
  const tight = config(); u16(tight, 126, 10);
  const route = snapshot(); route[105] = 1;
  const anchor = snapshot(); anchor[356]! ^= 1;
  const cases: [string, ReturnType<typeof verify>, string][] = [
    ["feed confidence", verify(base, tight), canonical(() => verifyFeedConfigForSnapshot(decodeLifecycleFeedConfigHeader(tight), decodeFeedSnapshotHeader(base), policy))],
    ["consumer confidence", verify(base, config(), { ...reader, maxConfidenceBps: 10 }), canonical(() => verifySnapshotHeader(decodeFeedSnapshotHeader(base), { ...policy, maxConfidenceBps: 10 }))],
    ["consumer notional", verify(base, config(), { ...reader, notional: 500001n }), canonical(() => verifySnapshotHeader(decodeFeedSnapshotHeader(base), { ...policy, notional: 500001n }))],
    ["routeability", verify(route), canonical(() => verifySnapshotHeader(decodeFeedSnapshotHeader(route), policy))],
    ["anchor policy", verify(anchor), canonical(() => verifyFeedConfigForSnapshot(decodeLifecycleFeedConfigHeader(config()), decodeFeedSnapshotHeader(anchor), policy))],
  ];
  for (const [name, sdk, reason] of cases) {
    assert.notEqual(reason, "accepted", name);
    assert.equal(sdk.ok, false, name);
    if (!sdk.ok) assert.equal("error" in sdk && sdk.error, reason, name);
  }
  const program = "11111111111111111111111111111113", clock = new Uint8Array(40); u64(clock, 0, 101n);
  let builds = 0;
  const builder = Object.assign(async () => { builds++; throw new Error("not-ready"); },
    { publication: async () => ({ check, ageLimits: { maxSnapshotAgeSlots: 5, maxSourceActivityAgeSlots: 5 }, expected }) });
  const rpc = { getMultipleAccounts: () => ({ send: async () => ({ value: [base, tight, clock].map((data) => ({ owner: program,
    data: [Buffer.from(data).toString("base64"), "base64"] })) }) }) };
  await assert.rejects(assessMimirRefresh({ programId: program as never, payer: program as never, target: { kind: "classic", feedConfig: check.config as never },
    consumer: { instructions: [{ programAddress: "11111111111111111111111111111114" as never, accounts: [], data: Uint8Array.of(1) }], computeUnits: 1,
      maxPublicationAgeSlots: 4, readerPolicy: reader }, buildRefreshGroup: builder as never, rpc: rpc as never }), /not-ready/);
  assert.equal(builds, 1);
  console.log("consumer verifier parity tests passed");
}

// Ready-first authenticates the selected plan; an unused paused fallback does not veto it.
{
  const program = PublicKey.unique(), payer = PublicKey.unique();
  const pda = (s: string, ...v: (Uint8Array | number[])[]) => PublicKey.findProgramAddressSync([Buffer.from(s), ...v.map((x) => Buffer.from(x))], program)[0];
  const feed = pda("feed_config", TEST_FEED_ID), primary = pda("sourcing_plan", TEST_FEED_ID, [1, 0], [1, 0]), fallback = pda("sourcing_plan", TEST_FEED_ID, [2, 0], [1, 0]);
  const plan = async (id: number, status: number) => {
    const b = Buffer.from(buildTestSourcingPlanHeader()); b.writeUInt16LE(id, 48); b[53] = status; b[301] = 1; b.writeUInt16LE(1, 302); b[304] = 1;
    const parts = [[301, 302], [302, 304], [304, 305], [16, 48], [48, 50], [50, 52], [52, 53], [54, 58], [58, 60], [60, 62], [64, 68], [68, 100], [100, 132],
      [132, 164], [164, 196], [228, 260], [260, 292], [292, 300]].map(([a, z]) => b.subarray(a, z));
    b.set(await mimirBetaHashv([Buffer.from("MIMIR_MINT_ORACLE_PLAN_V3"), ...parts]), 196); return b;
  };
  const live = await plan(1, 0), paused = await plan(2, 3), planHash = (await decodeMimirBetaLivePlan(live)).planHash;
  const cfg = config(); cfg.set(primary.toBytes(), 168); cfg.set(fallback.toBytes(), 200);
  const snap = snapshot(); snap.set(feed.toBytes(), 48); snap.set(planHash, 262);
  const rows = new Map([[feed.toBase58(), cfg], [primary.toBase58(), live], [fallback.toBase58(), paused]]);
  const connection = { getAccountInfo: async (k: PublicKey) => rows.has(k.toBase58()) ? { owner: program, data: Buffer.from(rows.get(k.toBase58())!), executable: false } : null };
  const builder = createMimirRefreshGroupBuilder({ connection: connection as never, profile: { cluster: "localnet", name: "custom", programId: program } as never,
    payer: payer.toBase58() as never });
  const clock = new Uint8Array(40); u64(clock, 0, 101n);
  const rpc = { getMultipleAccounts: () => ({ send: async () => ({ value: [snap, cfg, clock].map((data) => ({ owner: program.toBase58(),
    data: [Buffer.from(data).toString("base64"), "base64"] })) }) }) };
  const consumer = { instructions: [{ programAddress: PublicKey.unique().toBase58() as never, accounts: [], data: Uint8Array.of(1) }], computeUnits: 1, maxPublicationAgeSlots: 4 };
  const ready = await assessMimirRefresh({ programId: program.toBase58() as never, payer: payer.toBase58() as never,
    target: { kind: "classic", feedConfig: feed.toBase58() as never }, consumer, buildRefreshGroup: builder, rpc: rpc as never });
  assert.equal(ready.state, "ready");
  const pausedSnap = snapshot(); pausedSnap.set(feed.toBytes(), 48); pausedSnap.set((await plan(2, 3)).subarray(196, 228), 262);
  const publication = await builder.publication!({ kind: "classic", feedConfig: feed.toBase58() as never });
  const wrong = verifyMimirPublicationForConsumer({ data: pausedSnap, config: cfg, check: publication.check, clockSlot: 101n, maxPublicationAgeSlots: 4,
    expected: publication.expected });
  assert.deepEqual(wrong, { ok: false, reason: "WRONG_BINDING" });
  console.log("ready-first selected plan tests passed");
}

// Risk tier is a cap; mixed reader; stored interval; converter activity.
{
  const tierC = snapshot(); tierC[106] = 1;
  const tierBConfig = config(); tierBConfig[116] = 2;
  assert.equal(canonical(() => verifyFeedConfigForSnapshot(decodeLifecycleFeedConfigHeader(tierBConfig), decodeFeedSnapshotHeader(tierC), policy)), "accepted");
  assert.equal(verifyMimirPublicationForConsumer({ data: tierC, config: tierBConfig, check: check as never, clockSlot: 101n, maxPublicationAgeSlots: 5, expected }).ok, true);
  const tierA = verify(snapshot(), tierBConfig);
  assert.equal(!tierA.ok && "error" in tierA && tierA.error, "InvalidRouteability");
  const bounds = snapshot(); u128(bounds, 216, dv(bounds).getBigUint64(200, true) / 2n);
  const boundsVerdict = verify(bounds);
  assert.equal(!boundsVerdict.ok && "error" in boundsVerdict && boundsVerdict.error, "InvalidAccountData");
  const { readFileSync } = await import("node:fs");
  const point = new Uint8Array(readFileSync(new URL("./fixtures/current-point/point-snapshot.bin", import.meta.url))), h = decodeFeedSnapshotHeader(point), pointCfg = config();
  pointCfg.set(h.feedId, 16); pointCfg[116] = h.riskTier; pointCfg[120] = h.sourceCount; pointCfg[121] = h.venueCount; pointCfg[122] = h.correlationGroupCount;
  u16(pointCfg, 124, 0); pointCfg.set(h.anchorPolicyHash, 232); pointCfg.set(h.nativeExceptionHash, 264);
  const pointArgs = { data: point, config: pointCfg, check: { ...check, expectedSnapshotSource: 7 } as never, clockSlot: h.snapshotSlot, maxPublicationAgeSlots: 0 };
  const mixed = { expectedRouteabilityStatus: 4, maxConfidenceBps: 10_000, maxDispersionBps: 10_000, notional: 0n };
  assert.equal(verifyMimirPublicationForConsumer({ ...pointArgs, readerPolicy: { ...mixed, reader: "mixed" } }).ok, true);
  const floor = verifyMimirPublicationForConsumer({ ...pointArgs, readerPolicy: { ...mixed, reader: "mixed", notional: 401n } });
  assert.equal(!floor.ok && "error" in floor && floor.error, "NotionalTooLarge");
  const generic = verifyMimirPublicationForConsumer({ ...pointArgs, readerPolicy: mixed });
  assert.equal(!generic.ok && "error" in generic && generic.error, "InvalidSnapshotSource");
  console.log("tier cap, mixed reader, interval tests passed");
}

// Composite (CSP/CFC) verifier mirrors the canonical composite reader, one rejection per predicate.
{
  const { computeCompositeComponentSetHash, deriveCompositeFeedId, encodeCompositeFeedConfigHeader } = await import("../src/instructions.js");
  const { findCompositeFeedConfigPda, findCompositeSnapshotPda, findSourceConfigPda } = await import("../src/pda.js");
  const { computeCompositeComponentSnapshotHash, decodeCompositeFeedConfigHeader } = await import("../src/codec.js");
  const { verifyCompositeSnapshotAccount } = await import("../src/account.js");
  const { decodeMimirBrowserCompositeSnapshotHeader } = await import("../src/internal/nativeMonoRefreshCore.js");
  const { MIMIR_PROGRAM_ID: CANONICAL_MIMIR_PROGRAM_ID, MIMIR_MAINNET_USDC_MINT, RouteabilityStatus, RiskTier, SnapshotSource, FreshnessProfile, QuoteStatus,
    AnchorProvider, AnchorStatus } = await import("../src/constants.js");
  const Q64 = 1n << 64n;
  const feeds = [Buffer.alloc(32, 11), Buffer.alloc(32, 12)];
  const components = feeds.map((feedId, i) => ({ feedId, sourceConfig: findSourceConfigPda(feedId, 0)[0].toBytes(), quantityX64: Q64 * BigInt(i + 1) }));
  const args = { creator: new Uint8Array(32).fill(3), quoteMint: MIMIR_MAINNET_USDC_MINT.toBytes(), cluster: "localnet" as const, priceExponent: -6,
    maxSnapshotAgeSlots: 8, maxComponentSnapshotAgeSlots: 8, maxComponentConfidenceBps: 100, maxComponentDispersionBps: 150, registryEpoch: 1n,
    configRevision: 1n, adminConfigRevisionAtCreation: 9n, refreshFeeLamports: 1_000n, components };
  const feedId = deriveCompositeFeedId(args), [cfgKey] = findCompositeFeedConfigPda(feedId), [snapKey] = findCompositeSnapshotPda(feedId);
  const cfc = () => { const b = new Uint8Array(661).fill(44); b.set(encodeCompositeFeedConfigHeader(args)); u16(b, 8, 1); u16(b, 10, 661); return b; };
  const csp = (mut: (b: Uint8Array) => void = () => {}) => {
    const b = new Uint8Array(720); b.set(Buffer.from("MIMIRCSP")); u16(b, 10, 720);
    b.set(feedId, 16); b.set(cfgKey.toBytes(), 48); u64(b, 80, 1n); u64(b, 88, 1n); u64(b, 96, 1n);
    b[105] = RouteabilityStatus.SafetyOnly; b[106] = RiskTier.Unrated; b[107] = SnapshotSource.Composite; b[108] = FreshnessProfile.Hot0; b[109] = 2;
    b[110] = QuoteStatus.Ok; u64(b, 112, 100n); u64(b, 120, 108n); u64(b, 136, 99n); u64(b, 144, 98n);
    u64(b, 152, 3_000_000n); dv(b).setInt32(160, -6, true); u16(b, 164, 100); u16(b, 166, 150);
    u128(b, 168, Q64 * 3n); u128(b, 184, Q64 * 2n); u128(b, 200, Q64 * 4n); u128(b, 216, 1_000n); u128(b, 232, 2_000n);
    b.set(computeCompositeComponentSetHash(args), 248); b[312] = AnchorProvider.None; b[313] = AnchorStatus.Missing;
    components.forEach((k, i) => { const o = 320 + i * 80; b.set(k.feedId, o); u64(b, o + 32, BigInt(i + 2)); u64(b, o + 40, BigInt(99 + i)); u128(b, o + 48, Q64); u128(b, o + 64, k.quantityX64); });
    const parts = components.map((k, i) => ({ feedId: k.feedId, snapshotRevision: BigInt(i + 2), snapshotSlot: BigInt(99 + i), priceX64: Q64, contributionX64: k.quantityX64 }));
    b.set(computeCompositeComponentSnapshotHash({ componentCount: 2, components: parts }), 280);
    mut(b);
    return b;
  };
  const ccheck = { account: snapKey.toBase58(), config: cfgKey.toBase58(), kind: "composite-csp", slotOffset: 112, revisionOffset: 96, statusOffset: 104,
    expectedStatus: 0, validUntilSlotOffset: 120, snapshotSourceOffset: 107, expectedSnapshotSource: 4 } as const;
  const creader: MimirConsumerReaderPolicy = { expectedRouteabilityStatus: 4, maxConfidenceBps: 10_000, maxDispersionBps: 10_000, notional: 0n };
  const sdk = (data: Uint8Array, cfg = cfc(), clockSlot = 104n, readerPolicy = creader) =>
    verifyMimirPublicationForConsumer({ data, config: cfg, check: ccheck as never, clockSlot, maxPublicationAgeSlots: 64, readerPolicy,
      programId: CANONICAL_MIMIR_PROGRAM_ID.toBase58() as never });
  const program = (data: Uint8Array, cfg = cfc(), clockSlot = 104n) => canonical(() => verifyCompositeSnapshotAccount({ snapshot: snapKey,
    owner: CANONICAL_MIMIR_PROGRAM_ID, data, clockSlot, maxSnapshotAgeSlots: 8,
    config: { pubkey: cfgKey, owner: CANONICAL_MIMIR_PROGRAM_ID, data: cfg } }));
  const cfgCanon = (cfg: Uint8Array) => canonical(() => decodeCompositeFeedConfigHeader(cfg));
  const capped = (cfg: Uint8Array, h: ReturnType<typeof decodeMimirBrowserCompositeSnapshotHeader>, r: MimirConsumerReaderPolicy) =>
    canonical(() => { const c = decodeCompositeFeedConfigHeader(cfg);
      if (h.confidenceBps > r.maxConfidenceBps) throw new Error("ConfidenceTooWide");
      if (h.dispersionBps > r.maxDispersionBps) throw new Error("DispersionTooWide");
      if (r.notional > h.componentMinCapitalFloor) throw new Error("NotionalTooLarge"); });
  const base = csp();
  assert.equal(program(base), "accepted");
  assert.equal(sdk(base).ok, true);
  const wrongEmbedded = csp((b) => b.fill(9, 48, 80));
  assert.notEqual(program(wrongEmbedded), "accepted");
  assert.deepEqual(sdk(wrongEmbedded), { ok: false, reason: "FEED_POLICY", error: "InvalidCompositeSnapshot" });
  const wrongBump = cfc(); wrongBump[184] ^= 1;
  assert.equal(cfgCanon(wrongBump), "InvalidCompositeFeed");
  assert.deepEqual(sdk(base, wrongBump), { ok: false, reason: "FEED_POLICY", error: "InvalidCompositeFeed" });
  const cfgWith = (o: number, v: number) => { const b = cfc(); b[o] = v; return b; };
  const quality = (field: number, v: number) => csp((b) => u16(b, field, v));
  const contribution = csp((b) => { u128(b, 320 + 64, Q64 + 1n); u128(b, 168, Q64 * 3n + 1n); u128(b, 200, Q64 * 5n);
    b.set(computeCompositeComponentSnapshotHash(decodeMimirBrowserCompositeSnapshotHeader(b)), 280); });
  const converter = cfc(); converter.fill(9, 197, 229);
  const cases: [string, ReturnType<typeof sdk>, string][] = [
    ["CFC routeability cap", sdk(base, cfgWith(117, 3)), cfgCanon(cfgWith(117, 3))],
    ["CFC risk tier", sdk(base, cfgWith(118, 1)), cfgCanon(cfgWith(118, 1))],
    ["CSP risk tier", sdk(csp((b) => { b[106] = 1; }) ), canonical(() => decodeMimirBrowserCompositeSnapshotHeader(csp((b) => { b[106] = 1; })))],
    ["CSP routeability", sdk(csp((b) => { b[105] = 3; })), canonical(() => decodeMimirBrowserCompositeSnapshotHeader(csp((b) => { b[105] = 3; })))],
    ["source 4", sdk(csp((b) => { b[107] = 2; })), canonical(() => decodeMimirBrowserCompositeSnapshotHeader(csp((b) => { b[107] = 2; })))],
    ["component-set hash", sdk(csp((b) => { b[248]! ^= 1; })), program(csp((b) => { b[248]! ^= 1; }))],
    ["component contribution", sdk(contribution), program(contribution)],
    ["converter", sdk(base, converter), cfgCanon(converter)],
    ["age L (components)", sdk(base, cfc(), 108n), program(base, cfc(), 108n)],
    ["age M (CSP)", sdk(csp((b) => u64(b, 120, 200n)), cfc(), 109n), program(csp((b) => u64(b, 120, 200n)), cfc(), 109n)],
    ["consumer confidence", sdk(base, cfc(), 104n, { ...creader, maxConfidenceBps: 99 }), capped(cfc(), decodeMimirBrowserCompositeSnapshotHeader(base), { ...creader, maxConfidenceBps: 99 })],
    ["notional", sdk(base, cfc(), 104n, { ...creader, notional: 1_001n }), capped(cfc(), decodeMimirBrowserCompositeSnapshotHeader(base), { ...creader, notional: 1_001n })],
  ];
  for (const [name, verdict, reason] of cases) {
    assert.notEqual(reason, "accepted", name);
    assert.equal(verdict.ok, false, name);
  }
  const widened = csp((b) => { u16(b, 164, 190); u16(b, 166, 290); });
  assert.equal(program(widened), "accepted");
  assert.equal(sdk(widened).ok, true, "converter-widened interval beyond per-component caps");
  console.log("composite consumer verifier parity tests passed");
}
