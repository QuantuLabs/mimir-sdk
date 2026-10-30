import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import type { Address } from "@solana/kit";
import { createMimirRefreshGroupBuilder } from "../src/refreshGroup.js";
import { assessMimirRefresh, verifyMimirPublicationForConsumer, type MimirConsumerReaderPolicy } from "../src/beta/refreshPlanner.js";
import { decodeFeedSnapshotHeader, verifySnapshotHeader } from "../src/codec.js";
import { buildTestFeedConfigHeader, buildTestSnapshotHeader, buildTestSourcingPlanHeader, defaultTestSnapshotPolicy } from "../src/fixtures.js";
import { mimirBetaHashv } from "../src/beta/abi.js";
import { decodeMimirBetaLivePlan } from "../src/beta/liveAbi.js";
import { admitFrontier, frontierBindTag } from "../src/frontier.js";

const dv = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u16 = (b: Uint8Array, o: number, v: number) => dv(b).setUint16(o, v, true);
const u64 = (b: Uint8Array, o: number, v: bigint) => dv(b).setBigUint64(o, v, true);
const vectors = JSON.parse(readFileSync(new URL("./fixtures/frontier/VECTORS.json", import.meta.url), "utf8")) as { name: string; snapshot_hex: string }[];
const program = new PublicKey(new Uint8Array(32).fill(21)), payer = new PublicKey(new Uint8Array(32).fill(22)).toBase58() as Address;
const pda = (seed: string, ...values: (Uint8Array | number[])[]) =>
  PublicKey.findProgramAddressSync([Buffer.from(seed), ...values.map((v) => Buffer.from(v))], program)[0];
const consumerIx = [{ programAddress: "11111111111111111111111111111114" as Address, accounts: [], data: Uint8Array.of(1) }];

// The exported classic reader recomputes the stored confidence interval.
{
  const header = decodeFeedSnapshotHeader(buildTestSnapshotHeader());
  assert.throws(() => verifySnapshotHeader({ ...header, priceLowerX64: header.priceX64 / 2n }, defaultTestSnapshotPolicy()), /InvalidAccountData/);
}

for (const name of ["pos_src5_solua_like_0x81_0x82", "pos_src6_sampled_9_9_floor"]) {
  const data = Uint8Array.from(Buffer.from(vectors.find((v) => v.name === name)!.snapshot_hex, "hex")), h = decodeFeedSnapshotHeader(data);
  const feed = pda("feed_config", h.feedId), planKey = pda("sourcing_plan", h.feedId, [1, 0], [1, 0]), snapKey = pda("feed_snapshot", h.feedId);
  const plan = Buffer.from(buildTestSourcingPlanHeader()); plan.set(h.feedId, 16); plan.writeUInt16LE(1, 48); plan[53] = 0; plan[301] = 1; plan.writeUInt16LE(1, 302); plan[304] = 1;
  const offsets = [[301, 302], [302, 304], [304, 305], [16, 48], [48, 50], [50, 52], [52, 53], [54, 58], [58, 60], [60, 62], [64, 68], [68, 100], [100, 132],
    [132, 164], [164, 196], [228, 260], [260, 292], [292, 300]] as const;
  plan.set(await mimirBetaHashv([Buffer.from("MIMIR_MINT_ORACLE_PLAN_V3"), ...offsets.map(([a, z]) => plan.subarray(a, z))]), 196);
  const livePlan = await decodeMimirBetaLivePlan(plan);
  const cfg = new Uint8Array(357); cfg.set(buildTestFeedConfigHeader()); u16(cfg, 8, 1); u16(cfg, 10, 357); cfg.fill(8, 325); cfg.set(h.feedId, 16);
  u64(cfg, 80, h.registryEpoch); u64(cfg, 88, h.feedConfigRevision); dv(cfg).setInt32(112, h.priceExponent, true); cfg[116] = Math.max(1, h.riskTier);
  cfg[120] = h.sourceCount; cfg[121] = h.venueCount; cfg[122] = h.correlationGroupCount; u16(cfg, 124, 0); u16(cfg, 126, 10000); u16(cfg, 128, 10000);
  u16(cfg, 130, 150); u16(cfg, 132, 150); cfg.set(planKey.toBytes(), 168); cfg.fill(0, 200, 232); cfg.set(h.anchorPolicyHash, 232); cfg.set(h.nativeExceptionHash, 264);
  data.set(feed.toBytes(), 48); data.set(livePlan.planHash, 262); u16(data, 258, 1); u16(data, 260, 1); data[109] = livePlan.profile; data.set(frontierBindTag(cfg, plan), 164);
  const accounts = new Map([[feed.toBase58(), cfg], [planKey.toBase58(), plan], [snapKey.toBase58(), data]]);
  const connection = { getAccountInfo: async (key: PublicKey) => accounts.has(key.toBase58())
    ? { owner: program, executable: false, lamports: 1, data: Buffer.from(accounts.get(key.toBase58())!) } : null };
  const real = createMimirRefreshGroupBuilder({ connection: connection as never, profile: { cluster: "localnet", name: "custom", programId: program } as never, payer });
  const target = { kind: "classic", feedConfig: feed.toBase58() as Address } as const;
  const publication = await real.publication!(target);
  assert.equal(publication.check.expectedCapModelVersion, h.snapshotSource === 6 ? 0 : 2);
  const now = dv(data).getBigInt64(132, true);
  const readerPolicy: MimirConsumerReaderPolicy = { reader: "mixed", expectedRouteabilityStatus: h.routeabilityStatus, maxConfidenceBps: 10000,
    maxDispersionBps: 10000, notional: 1n, frontierMaxAge: 150, frontierMaxSourceAgeSlots: 150n };
  const verify = (d: Uint8Array, r: MimirConsumerReaderPolicy = readerPolicy, clockUnixTimestamp: bigint | null = now) =>
    verifyMimirPublicationForConsumer({ data: d, config: cfg, check: publication.check, clockSlot: h.snapshotSlot, maxPublicationAgeSlots: 0,
      expected: publication.expected, readerPolicy: r, ...(clockUnixTimestamp !== null ? { clockUnixTimestamp } : {}) });
  assert.equal(verify(data).ok, true, name);
  const generic = verify(data, { ...readerPolicy, reader: "generic" });
  assert.equal(!generic.ok && "error" in generic && generic.error, "InvalidSnapshotSource");
  for (const missing of [verify(data, readerPolicy, null), verify(data, { ...readerPolicy, frontierMaxAge: undefined })])
    assert.equal(!missing.ok && "error" in missing && missing.error, "MissingFrontierPolicy");
  if (h.snapshotSource === 6) assert.equal(verifyMimirPublicationForConsumer({ data, config: cfg, check: { ...publication.check, expectedCapModelVersion: 2 },
    clockSlot: h.snapshotSlot, maxPublicationAgeSlots: 0, readerPolicy, clockUnixTimestamp: now }).ok, false);

  const ineligible = Uint8Array.from(data); ineligible[186] = 0;
  assert.equal(admitFrontier(ineligible, { maxAge: 150, maxSourceAge: 150n, maxConfidenceBps: 10000 }, h.snapshotSlot, now), false);
  const rejected = verify(ineligible);
  assert.equal(!rejected.ok && "error" in rejected && rejected.error, "FrontierNotAdmitted");

  const clock = new Uint8Array(40); u64(clock, 0, h.snapshotSlot); dv(clock).setBigInt64(32, now, true);
  const assess = async (snapshot: Uint8Array) => {
    let builds = 0;
    const wrapper = Object.assign(async () => { builds++; throw new Error("refresh-required"); }, { publication: real.publication });
    const rpc = { getMultipleAccounts: () => ({ send: async () => ({ value: [snapshot, cfg, clock].map((b) => ({ owner: program.toBase58(), data: b })) }) }) };
    const state = await assessMimirRefresh({ programId: program.toBase58() as Address, payer, target, buildRefreshGroup: wrapper as never, rpc: rpc as never,
      consumer: { instructions: consumerIx, computeUnits: 1, maxPublicationAgeSlots: 0, readerPolicy } }).then((r) => r.state, (e: Error) => e.message);
    return { state, builds };
  };
  assert.deepEqual(await assess(data), { state: "ready", builds: 0 }, name);
  assert.deepEqual(await assess(ineligible), { state: "refresh-required", builds: 1 }, name);
}

console.log("mixed reader admission tests passed");
