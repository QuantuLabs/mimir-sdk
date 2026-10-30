import assert from "node:assert/strict";
import { getAddressDecoder, getAddressEncoder, type Address } from "@solana/kit";
import { decodeMimirBetaLivePlan, decodeMimirBetaLiveSource } from "../src/beta/liveAbi.js";
import { decodeMimirBetaCaptureCandidate, deriveMimirBetaFeedPdas,
  type MimirBetaEligiblePool } from "../src/beta/index.js";
import { assertMimirClassicConverterAdmitted, deriveMimirClassicRecipe } from "../src/beta/classicExecution.js";
import { makeBetaCaptureFixture } from "./fixtures/betaCaptureFixtures.js";
import { withReadyNativeHistory } from "./fixtures/nativeReadyHistory.js";
import { buildMimirV1ClassicDefinition, decodeV1Descriptor, deriveMimirV1ClassicFeedId, MIMIR_V1_MAINNET_PROGRAM_ID,
  planMimirV1ClassicCreationFromPools } from "../src/v1/index.js";
import * as K from "../src/v1/layout/classic.js";

const addr = (byte: number): Address => getAddressDecoder().decode(Uint8Array.from({ length: 32 }, () => byte));
const programId = MIMIR_V1_MAINNET_PROGRAM_ID;
const fixture = await makeBetaCaptureFixture("raydium-clmm", { seed: 11 });
const c = await decodeMimirBetaCaptureCandidate(fixture.input);
const pool: MimirBetaEligiblePool = {
  eligibility: "eligible", family: "raydium-clmm", programId: c.programId, pool: c.pool, descriptorId: c.descriptorId, descriptorHash: c.descriptorHash,
  readPlan: fixture.input.expectedPlan, canonicalMint0: c.canonicalMint0, canonicalMint1: c.canonicalMint1, canonicalPairKey: c.canonicalPairKey,
  direction: "quote-per-base", baseMint: c.baseMint, quoteMint: c.quoteMint, baseVault: c.baseVault, quoteVault: c.quoteVault,
  adapterVersion: c.adapterVersion, token2022Mint: c.token2022Mint, token2022PolicyHash: c.token2022PolicyHash,
  minLiquidityNative: 1n, minDepthTo50BpsNative: 1_000n, observedSlot: 1n, validThroughSlot: 2n, evidenceHash: "a".repeat(64), creation: fixture.creation,
};
const physicalAccounts = fixture.creation.staticAccounts.map(({ address }) => {
  const account = fixture.fixtureAccounts.find((row) => row.address === address)!;
  return { address, owner: account.owner, executable: account.executable };
});
const recipe = deriveMimirClassicRecipe({ role: "primary", adapterType: 1, adapterVersion: c.adapterVersion, externalWidth: 7, minSlotGap: 1 });
const policy = { profile: 0, riskTier: 1, priceExponent: -8, maxDispersionBps: 100, maxSourceActivityAgeSlots: 150, minCoverageRatioBps: 10_000,
  maxConfidenceBps: 500, maxSnapshotAgeSlots: 150, anchorPolicyHash: new Uint8Array(32).fill(7), nativeExceptionHash: new Uint8Array(32).fill(8) };
const args = { programId, baseMint: c.baseMint, quoteMint: c.quoteMint, baseDecimals: 9, quoteDecimals: 6, ticker: "SOLX", variant: 1,
  registryEpoch: 3n, policy, pools: [pool], physicalAccounts, rows: [{ recipe }] };

const def = await buildMimirV1ClassicDefinition(args);
const feedId = await deriveMimirV1ClassicFeedId(c.baseMint, c.quoteMint, 1);
const pdas = await deriveMimirBetaFeedPdas({ programId, feedId });
const view = (b: Uint8Array) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const { feedImage, planImage, rows } = def.definition;
assert.equal(def.feedId, feedId);
assert.equal([feedImage.length, planImage.length, rows[0]!.descriptor.length, rows[0]!.sourceImage.length].join(), "325,320,16,384");
// V0 feed image with the primary ticker, would-be v0 pointers and canonical bumps under the V1 id.
assert.equal(new TextDecoder().decode(feedImage.subarray(0, 8)), "MIMIRCFG");
assert.equal(view(feedImage).getUint16(K.CFG_OFFSET_VERSION, true), 0);
assert.equal(view(feedImage).getUint16(K.CFG_OFFSET_HEADER_LEN, true), 325);
assert.equal(view(feedImage).getUint32(K.CFG_OFFSET_FLAGS, true), 1);
assert.deepEqual([...feedImage.subarray(313, 325)], [4, ..."SOLX"].map((x) => typeof x === "string" ? x.charCodeAt(0) : x).concat(Array(7).fill(0)));
assert.equal(feedImage[K.CFG_OFFSET_BUMP], pdas.feed[1]);
assert.equal(feedImage[K.CFG_OFFSET_LIFECYCLE_STATE], 3);
assert.equal(view(feedImage).getBigUint64(K.CFG_OFFSET_REGISTRY_EPOCH, true), 3n);
assert.equal(getAddressDecoder().decode(feedImage.subarray(K.CFG_OFFSET_DEFAULT_SOURCING_PLAN, K.CFG_OFFSET_DEFAULT_SOURCING_PLAN + 32)), pdas.sourcingPlan[0]);
// Plan image decodes with the v1 codec (plan hash re-derived there).
const plan = await decodeMimirBetaLivePlan(planImage);
assert.equal(plan.status, 0); assert.equal(plan.minSources, 1); assert.equal(planImage[K.PLAN_OFFSET_BUMP], pdas.sourcingPlan[1]);
assert.equal(getAddressDecoder().decode(planImage.subarray(K.PLAN_OFFSET_TWAP_STATE, K.PLAN_OFFSET_TWAP_STATE + 32)), pdas.twap[0]);
assert.deepEqual(planImage.subarray(K.PLAN_OFFSET_PLAN_HASH, K.PLAN_OFFSET_PLAN_HASH + 32), def.planHash);
// Source image decodes with the v1 codec and carries the canonical R-08 bump.
const source = decodeMimirBetaLiveSource(rows[0]!.sourceImage);
assert.equal(source.sourceIndex, 0); assert.equal(source.adapterType, 1);
assert.equal(source.poolOrMarket.length, 32);
// Descriptor: static binding v1, no module; exact length n=1 s=0 = rows end + full membership.
const d = decodeV1Descriptor(rows[0]!.descriptor);
assert.equal(d.externalWidth, 7); assert.equal(d.bindingVersion, 1); assert.equal(d.moduleLen, 0);
assert.equal(def.exactLen, 1558 + 944 + 4 + 65 * d.bindingWidth);

// Planner: one SINGLE CREATE_CLASSIC tx, `663 + 400n` B of data, 10 fixed metas + the vector, 4-char tariff = base / 2.
const externals = Array.from({ length: 7 }, (_, i) => addr(60 + i));
const planned = await planMimirV1ClassicCreationFromPools({ ...args, rows: [{ recipe, externals }], payer: addr(50), colaMint: addr(51), colaBaseAmountRaw: 1_000n, tickerTierTenths: [150, 30, 5, 2] });
const ix = planned.plan.instructions.at(-1)!;
assert.equal(planned.plan.instructions.length, 1);
assert.equal(ix.data.length, 663 + 400);
assert.deepEqual([...ix.data.subarray(0, 8)], [93, 1, 0, 1, 0, def.feedBump, ix.data[6], ix.data[7]]);
assert.equal(view(ix.data).getBigUint64(8, true), 500n);
assert.equal(view(ix.data).getUint16(ix.data.length - 2, true), 1);
assert.equal(ix.accounts.length, 10 + 7);
assert.equal(ix.accounts[1]!.address, def.feed);

// Refusals: variant/feed mismatch is impossible by construction; quote wSOL needs the SOL feed; tier floors.
await assert.rejects(buildMimirV1ClassicDefinition({ ...args, policy: { ...policy, riskTier: 3 } }), /risk-tier floors/);
await assert.rejects(buildMimirV1ClassicDefinition({ ...args, rows: [] }), /1-5 pools/);

// RPC preparer: one coherent read → the same definition (spot row over the captured CLMM closure).
const { findMimirV1AdminConfigPda, findMimirV1RegistryPda, prepareMimirV1ClassicCreation } = await import("../src/v1/index.js");
const [adminAddress] = await findMimirV1AdminConfigPda(programId); const [registryAddress] = await findMimirV1RegistryPda(programId);
const admin = new Uint8Array(192); const av = view(admin);
admin.set(new TextEncoder().encode("MIMIRCFG")); av.setUint16(8, 1, true); av.setUint16(10, 192, true); admin[12] = 1; admin[13] = 255;
admin.fill(1, 16, 48); admin.set(new Uint8Array(32).fill(51), 48); av.setBigUint64(80, 1_000n, true); admin[88] = 1; admin[89] = 3;
admin.set([150, 30, 5, 2], 116); admin.fill(2, 120, 152); av.setBigUint64(152, 1n, true); admin.fill(3, 160, 192);
const registry = new Uint8Array(128); const rv = view(registry);
registry.set(new TextEncoder().encode("MIMIRREG")); rv.setUint16(10, 128, true); registry.fill(4, 16, 48); rv.setBigUint64(96, 3n, true);
const store = new Map<Address, { owner: Address; executable: boolean; data: Uint8Array }>(fixture.fixtureAccounts.map((x) => [x.address, x]));
store.set(adminAddress, { owner: programId, executable: false, data: admin }); store.set(registryAddress, { owner: programId, executable: false, data: registry });
const mint = (decimals: number) => { const d = new Uint8Array(82); d[44] = decimals; d[45] = 1; return { owner: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address, executable: false, data: d }; };
if (!store.has(c.baseMint)) store.set(c.baseMint, mint(9));
if (!store.has(c.quoteMint)) store.set(c.quoteMint, mint(6));
withReadyNativeHistory(store, 9n);
const rpcAccount = (x: Address) => { const a = store.get(x); return a ? { owner: a.owner, executable: a.executable, lamports: 1n, rentEpoch: 0n,
  space: BigInt(a.data.length), data: [Buffer.from(a.data).toString("base64"), "base64"] } : null; };
const rpc = { getAccountInfo: (x: Address) => ({ send: async () => ({ context: { slot: 9n }, value: rpcAccount(x) }) }),
  getMultipleAccounts: (xs: readonly Address[]) => ({ send: async () => ({ context: { slot: 9n }, value: xs.map(rpcAccount) }) }) };
const prepared = await prepareMimirV1ClassicCreation(rpc, { programId, payer: addr(50), ticker: "SOLX", baseMint: c.baseMint, quoteMint: c.quoteMint,
  pools: [pool], policy, variant: "new" });
assert.equal(prepared.definition.variant, 1);
assert.equal(prepared.colaAmountRaw, 500n);
assert.equal(prepared.plan.instructions.length, 1);
assert.equal(decodeV1Descriptor(prepared.definition.rows[0]!.descriptor).mode, d.mode);
// Recipes as v1: native-bounded CLMM = mode 2, spot vector + the CLMM observation, derived membership; a converter-admitted SOL row.
const native = await prepareMimirV1ClassicCreation(rpc, { programId, payer: addr(50), ticker: "SOLX", baseMint: c.baseMint, quoteMint: c.quoteMint,
  pools: [pool], policy, variant: 1, recipes: ["native-bounded"] });
const nd = decodeV1Descriptor(native.definition.rows[0]!.descriptor);
assert.equal(nd.mode, 2); assert.equal(nd.temporalKind, 0); assert.equal(nd.externalWidth, d.externalWidth + 1);
assert.equal(native.definition.rows[0]!.descriptor[15]! & 2, 2);
assert.equal(native.plan.instructions.at(-1)!.accounts.at(10 + nd.externalWidth - 1)!.address,
  pool.readPlan.auxiliary.find((x) => x.role === "clmm-observation")!.address);
assertMimirClassicConverterAdmitted([nd as unknown as Parameters<typeof assertMimirClassicConverterAdmitted>[0][number]]);
// Auto tolerances from the pools read here: native-bounded → the 300 bps window floor, snapshot age from the measured 400 ms slot, activity age the
// u16 maximum (a quiet pool is never refused for activity age); a cap under a row is refused.
const autoArgs = { programId, payer: addr(50), ticker: "SOLX", baseMint: c.baseMint, quoteMint: c.quoteMint, pools: [pool], policy, variant: 1, recipes: ["native-bounded" as const] };
const autoNative = await prepareMimirV1ClassicCreation(rpc, { ...autoArgs, auto: { slotMs: 400 } });
assert.deepEqual([autoNative.policy.maxConfidenceBps, autoNative.policy.maxSnapshotAgeSlots, autoNative.policy.maxSourceActivityAgeSlots, autoNative.policy.minCoverageRatioBps],
  [300, 188, 65_535, 8_000]);
assert.equal(view(autoNative.definition.feedImage).getUint16(126, true), 300);
assert.deepEqual([view(autoNative.definition.feedImage).getUint16(K.CFG_OFFSET_MAX_SOURCE_ACTIVITY_AGE_SLOTS, true),
  view(autoNative.definition.planImage).getUint16(K.PLAN_OFFSET_MAX_SOURCE_ACTIVITY_AGE_SLOTS, true)], [65_535, 65_535]);
await assert.rejects(prepareMimirV1ClassicCreation(rpc, { ...autoArgs, auto: { slotMs: 400, overrides: { maxConfidenceBps: 4 } } }), /FEED_UNPRICEABLE:Source 1 \(raydium-clmm/);
// `observe` reads the preparer's own pool accounts: its observed price sets the exponent, and its throw refuses the creation.
const observedAuto = await prepareMimirV1ClassicCreation(rpc, { ...autoArgs, auto: { slotMs: 400, observe: async (accounts) => {
  assert.ok(accounts.get(pool.pool)); return { observedPrice: 4e-9 }; } } });
assert.equal(observedAuto.policy.priceExponent, -16); assert.deepEqual(observedAuto.widenedBy, autoNative.widenedBy);
await assert.rejects(prepareMimirV1ClassicCreation(rpc, { ...autoArgs, auto: { slotMs: 400, observe: async () => { throw new Error("pools apart"); } } }), /pools apart/);
await assert.rejects(prepareMimirV1ClassicCreation(rpc, { programId, payer: addr(50), ticker: "SOLX", baseMint: c.baseMint, quoteMint: c.quoteMint,
  pools: [pool], policy, variant: 1, recipes: ["current-point"] }), /classic recipes must be/);
// Supplied sampled rows keep their semantics over AMMv4/PumpSwap (flags 0, mode 4); the default rows infer current-point (flags 1).
const { mimirClassicRow } = await import("../src/beta/classicExecution.js");
const { freshAdapterAccounts } = await import("../src/beta/live.js");
for (const family of ["raydium-amm-v4", "pumpswap"] as const) {
  const f = await makeBetaCaptureFixture(family, { seed: 11 });
  const fc = await decodeMimirBetaCaptureCandidate(f.input);
  const fp: MimirBetaEligiblePool = { ...pool, family, programId: fc.programId, pool: fc.pool, descriptorId: fc.descriptorId, descriptorHash: fc.descriptorHash,
    readPlan: f.input.expectedPlan, canonicalMint0: fc.canonicalMint0, canonicalMint1: fc.canonicalMint1, canonicalPairKey: fc.canonicalPairKey,
    baseMint: fc.baseMint, quoteMint: fc.quoteMint, baseVault: fc.baseVault, quoteVault: fc.quoteVault, adapterVersion: fc.adapterVersion,
    token2022Mint: fc.token2022Mint, token2022PolicyHash: fc.token2022PolicyHash, creation: f.creation };
  for (const x of f.fixtureAccounts) store.set(x.address, x);
  if (!store.has(fc.baseMint)) store.set(fc.baseMint, mint(9));
  if (!store.has(fc.quoteMint)) store.set(fc.quoteMint, mint(6));
  const base = { programId, payer: addr(50), ticker: "SOLX", baseMint: fc.baseMint, quoteMint: fc.quoteMint, pools: [fp], policy, variant: 1 };
  const flags = (x: Awaited<ReturnType<typeof prepareMimirV1ClassicCreation>>) =>
    view(x.definition.rows[0]!.sourceImage).getUint32(K.SRC_OFFSET_FLAGS, true);
  const point = await prepareMimirV1ClassicCreation(rpc, base);
  assert.equal(flags(point), 1, family);
  const sampled = mimirClassicRow({ role: "primary", adapterType: f.creation.adapterType, adapterVersion: f.creation.adapterVersion, currentPoint: false,
    sourceConfig: programId, feedConfig: programId, sourcingPlan: programId, adapterAccounts: await freshAdapterAccounts(fp, new Map([...store].map(([address, x]) => [address, { ...x, address, lamports: 1n }])), true),
    witness: { feedId: new Uint8Array(32), sourceIndex: 0, ringVersion: 1, minSlotGap: 1, expectedSourceConfigRevision: 1n, expectedSourceSetRevision: 1n,
      expectedPlanHash: new Uint8Array(32), sourceSetSiblings: [], accountsSiblings: [] } });
  const kept = await prepareMimirV1ClassicCreation(rpc, { ...base, rows: [sampled] });
  assert.equal(flags(kept), 0, family);
  const kd = decodeV1Descriptor(kept.definition.rows[0]!.descriptor);
  assert.equal(kd.mode, 4, family); assert.equal(kd.temporalKind, 4, family);
}
// Orca adaptive CREATE witness: legacy plans unchanged; an adaptive pool's canonical Oracle follows the source group, re-validated against
// the authentic Clock (T ≤ now admits, a future enablement is POOL_INELIGIBLE), never in the stored definition.
{
  const { MIMIR_NATIVE_CLOCK_ADDRESS } = await import("../src/internal/nativeMonoRefreshCore.js");
  const clock = new Uint8Array(40); view(clock).setBigUint64(0, 9n, true); view(clock).setBigInt64(32, 100n, true);
  store.set(MIMIR_NATIVE_CLOCK_ADDRESS, { owner: "Sysvar1111111111111111111111111111111111111" as Address, executable: false, data: clock });
  const orcaPool = async (t?: bigint) => {
    const f = await makeBetaCaptureFixture("orca-whirlpool", { seed: 12, ...(t === undefined ? {} : { orcaTradeEnableTimestamp: t }) });
    const fc = await decodeMimirBetaCaptureCandidate(f.input);
    for (const x of f.fixtureAccounts) store.set(x.address, x);
    const p: MimirBetaEligiblePool = { ...pool, family: "orca-whirlpool", programId: fc.programId, pool: fc.pool, descriptorId: fc.descriptorId, descriptorHash: fc.descriptorHash,
      readPlan: f.input.expectedPlan, canonicalMint0: fc.canonicalMint0, canonicalMint1: fc.canonicalMint1, canonicalPairKey: fc.canonicalPairKey,
      baseMint: fc.baseMint, quoteMint: fc.quoteMint, baseVault: fc.baseVault, quoteVault: fc.quoteVault, adapterVersion: fc.adapterVersion,
      token2022Mint: fc.token2022Mint, token2022PolicyHash: fc.token2022PolicyHash, creation: f.creation };
    return { p, oracle: f.input.expectedPlan.auxiliary.find((x) => x.role === "orca-oracle")?.address };
  };
  const run = (p: MimirBetaEligiblePool) => prepareMimirV1ClassicCreation(rpc, { programId, payer: addr(50), ticker: "SOLX", baseMint: p.baseMint, quoteMint: p.quoteMint, pools: [p], policy, variant: 1 });
  const legacy = await orcaPool();
  assert.equal(legacy.oracle, undefined);
  const lp = await run(legacy.p), lix = lp.plan.instructions.at(-1)!;
  const width = decodeV1Descriptor(lp.definition.rows[0]!.descriptor).externalWidth;
  assert.equal(lix.accounts.length, 10 + width, "legacy Orca: original metas");
  const adaptive = await orcaPool(0n);
  const setT = (t: bigint) => view(store.get(adaptive.oracle!)!.data).setBigUint64(40, t, true);
  for (const t of [0n, 99n, 100n]) {
    setT(t);
    const got = await run(adaptive.p), aix = got.plan.instructions.at(-1)!;
    assert.equal(aix.accounts.length, 10 + width + 1, `T=${t}`);
    assert.deepEqual(aix.accounts.at(-1), { ...aix.accounts.at(-1)!, address: adaptive.oracle, isSigner: false, isWritable: false });
    assert.ok(!got.definition.rows.some((r) => Buffer.from(r.sourceImage).includes(Buffer.from(getAddressEncoder().encode(adaptive.oracle!)))));
  }
  setT(101n);
  await assert.rejects(run(adaptive.p), (e: { code?: string }) => e.code === "POOL_INELIGIBLE", "future enablement at CREATE");
  setT(0n);
  store.set(MIMIR_NATIVE_CLOCK_ADDRESS, { ...store.get(MIMIR_NATIVE_CLOCK_ADDRESS)!, data: new Uint8Array(40) });
  await assert.rejects(run(adaptive.p), (e: { code?: string }) => e.code === "RPC_CONTEXT_MISMATCH", "Clock must be authentic");
}
// CPMM: an omitted recipe is economic spot (mode 0, E4); explicit native-bounded stays mode 2.
{
  const f = await makeBetaCaptureFixture("raydium-cpmm", { seed: 13 });
  const fc = await decodeMimirBetaCaptureCandidate(f.input);
  const p: MimirBetaEligiblePool = { ...pool, family: "raydium-cpmm", programId: fc.programId, pool: fc.pool, descriptorId: fc.descriptorId, descriptorHash: fc.descriptorHash,
    readPlan: f.input.expectedPlan, canonicalMint0: fc.canonicalMint0, canonicalMint1: fc.canonicalMint1, canonicalPairKey: fc.canonicalPairKey,
    baseMint: fc.baseMint, quoteMint: fc.quoteMint, baseVault: fc.baseVault, quoteVault: fc.quoteVault, adapterVersion: fc.adapterVersion,
    token2022Mint: fc.token2022Mint, token2022PolicyHash: fc.token2022PolicyHash, creation: f.creation };
  for (const x of f.fixtureAccounts) store.set(x.address, x);
  withReadyNativeHistory(store, 9n);
  const base = { programId, payer: addr(50), ticker: "SOLX", baseMint: p.baseMint, quoteMint: p.quoteMint, pools: [p], policy, variant: 1 };
  const desc = async (recipes?: ("native-bounded" | null)[]) => decodeV1Descriptor((await prepareMimirV1ClassicCreation(rpc, { ...base, ...(recipes ? { recipes } : {}) })).definition.rows[0]!.descriptor);
  for (const r of [undefined, [null]]) { const x = await desc(r); assert.equal(x.mode, 0); assert.equal(x.externalWidth, 4); }
  assert.equal((await desc(["native-bounded"])).mode, 2);
}
console.log("v1Definition ok");
