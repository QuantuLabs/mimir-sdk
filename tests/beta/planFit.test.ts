import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { planFit, planFitReads, marketFitForPlan, type PlanFitPlan } from "../../src/beta/planFit.js";
import { mimirBetaSourceQualityFloorBps } from "../../src/beta/creation.js";
import { MARKET_RULES, type MarketRules } from "../../src/easy/marketRules.js";
import { composeConfBps } from "../../src/easy/marketFit.js";
import { extractMeteoraDlmmNativeTwapSample, mimirNativeLagEnvelope } from "../../src/internal/nativeMonoRefreshCore.js";
import { meteoraDlmmPriceFromCumulativeBinX64, meteoraDlmmPriceFromIdX64 } from "../../src/math.js";
import type { MimirBetaAccount } from "../../src/beta/types.js";
import { addressBytes, bytesAddress } from "../../src/beta/bytes.js";
import { derivePdaSync, mimirBetaCaptureScanDescriptors } from "../../src/beta/capture.js";
import { decodeV1ClassicFeed } from "../../src/v1/decoders.js";
import { getProgramDerivedAddress, type Address } from "@solana/kit";
import { marketFit } from "../../src/easy/marketFit.js";
import type { MimirBetaEligiblePool } from "../../src/beta/discovery.js";

const fx = JSON.parse(readFileSync(new URL("../fixtures/plan-fit-jup.json", import.meta.url), "utf8"));
const HBYR = "hBYrGHXVCQsnduDERkVnViCXNYawpHCvN5y3GsMiMiR" as never;
const CLOCK = "SysvarC1ock11111111111111111111111111111111", SOLFEED = "F5fXuWuVFwBF3eBVtFkxXS5PMY651uVQ1bL4W4mse5Qj";
const ORACLE = "ECdXuXs7Sqsp9CaoA2LuZxYZnbs3oGA4tT7NNQARcsir";
const slot = BigInt(fx.slot);
const recorded = new Map<string, MimirBetaAccount>(fx.accounts.map((a: { address: string; owner: string; executable: boolean; data: string }) =>
  [a.address, { address: a.address, owner: a.owner, executable: a.executable, data: new Uint8Array(Buffer.from(a.data, "base64")) } as MimirBetaAccount]));
const key = (d: Uint8Array, at: number) => bytesAddress(d.subarray(at, at + 32));
const C8 = recorded.get(fx.pool)!.data;
type PoolOpts = Partial<{ family: string; adapterType: number; adapterVersion: number; pool: string; depth: bigint; programId: string; baseVault: string; quoteVault: string;
  baseMint: string; quoteMint: string }>;
const pool = (o: PoolOpts) => ({
  eligibility: "eligible", family: o.family ?? "meteora-dlmm", programId: o.programId ?? fx.programId, pool: o.pool ?? fx.pool,
  baseMint: o.baseMint ?? fx.baseMint, quoteMint: o.quoteMint ?? fx.quoteMint, baseVault: o.baseVault ?? key(C8, 152), quoteVault: o.quoteVault ?? key(C8, 184),
  minLiquidityNative: 1n, minDepthTo50BpsNative: o.depth ?? BigInt(fx.minDepthTo50BpsNative),
  readPlan: { auxiliary: [] }, creation: { adapterType: o.adapterType ?? 3, adapterVersion: o.adapterVersion ?? 0, bindingVariant: "direct" },
}) as unknown as MimirBetaEligiblePool;
/** Test-made pool accounts that pass the SDK capture reader (descriptor allocation, discriminator, status, PDAs, mints, vaults). */
const filled = (n: number) => bytesAddress(new Uint8Array(32).fill(n));
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
async function made(family: "pumpswap" | "raydium-cpmm" | "meteora-damm-v2", tag: number, o: PoolOpts = {}) {
  const d = mimirBetaCaptureScanDescriptors().find((x) => x.family === family && x.allocationSize !== 287 && x.allocationSize !== 301)!;
  const data = new Uint8Array(d.allocationSize); data.set(d.discriminator!, d.discriminatorOffset);
  const [mintA, mintB, vaultA, vaultB] = [fx.baseMint, USDC, filled(tag), filled(tag + 1)];
  for (const [at, v] of [[d.mintAOffset, mintA], [d.mintBOffset, mintB], [d.vaultAOffset, vaultA], [d.vaultBOffset, vaultB]] as const) data.set(addressBytes(v as Address), at);
  let address = filled(tag + 2);
  if (family === "pumpswap") {
    const creator = filled(tag + 3); data.set(addressBytes(creator), 11);
    const [pda, bump] = await getProgramDerivedAddress({ programAddress: d.programId, seeds: [Buffer.from("pool"), data.subarray(9, 11), addressBytes(creator),
      addressBytes(mintA as Address), addressBytes(mintB as Address)] });
    address = pda; data[8] = bump; data.set(addressBytes(derivePdaSync(d.programId, [Buffer.from("pool_lp_mint"), addressBytes(pda)])), 107);
  } else if (family === "raydium-cpmm") {
    data.set(addressBytes(filled(tag + 3)), 8); data.set(addressBytes(derivePdaSync(d.programId, [Buffer.from("observation"), addressBytes(address)])), 296);
  } else data[456] = 1;
  const p = pool({ family, programId: d.programId, pool: address, baseMint: mintA, quoteMint: mintB, baseVault: vaultA, quoteVault: vaultB,
    adapterType: { pumpswap: 6, "raydium-cpmm": 2, "meteora-damm-v2": 7 }[family], ...o });
  return { pool: p, account: { address, owner: d.programId, executable: false, data } as unknown as MimirBetaAccount };
}
const JUP: PlanFitPlan = { pools: [pool({})], recipes: ["native-bounded"], quote: "SOL", programId: HBYR, variant: "new" };
const run = async (plan: PlanFitPlan, accounts: Map<string, MimirBetaAccount | null> | undefined = recorded, rules?: MarketRules) =>
  marketFitForPlan(await planFit({ ...plan, accounts, slot, ...(rules ? { rules } : {}) }));
const runE = async (plan: PlanFitPlan, accounts: Map<string, MimirBetaAccount | null> | undefined = recorded) =>
  marketFitForPlan(evidence(await planFit({ ...plan, accounts, slot })));
/** The made pool accounts and the Clock the authentication reads. */
const boundTo = (...made: { account: MimirBetaAccount }[]) => new Map<string, MimirBetaAccount | null>([[CLOCK, recorded.get(CLOCK)!],
  ...made.map((x) => [x.account.address, x.account] as [string, MimirBetaAccount])]);
/** Evidence planFit does not read, supplied as the caller would after authenticating it: the SOL converter cap (its publication floor
 * F/10, lib.rs classic_converter_sample), the converter refresh's source condition (bin arrays and vaults, P processor.rs:29066-29092) and
 * the FeedOI headroom, primary and conversion (lib.rs:1694-1760). Without it a plan stays MISSING_CAPACITY / MISSING_CONVERTER / MISSING_OI. */
const OI = { feedOiHeadroomUsdc6: 1_000_000_000_000n, conversionOiHeadroomUsdc6: 1_000_000_000_000n };
const evidence = (fit: Awaited<ReturnType<typeof planFit>>, cap = true): typeof fit => ({ ...fit, cohort: { ...fit.cohort,
  capacity: { ...fit.cohort.capacity, ...OI, ...(cap ? { converterUsdc6: 10_000_000_000n } : {}) },
  ...(fit.cohort.converter ? { converter: { ...fit.cohort.converter, condition: 0 } } : {}) } });
const withEvidence = (fit: Awaited<ReturnType<typeof planFit>>) => marketFitForPlan(evidence(fit));
/** Only the converter cap: the pre-round-3 completion, no longer enough. */
const withConverterCap = (fit: Awaited<ReturnType<typeof planFit>>) =>
  marketFitForPlan({ ...fit, cohort: { ...fit.cohort, capacity: { ...fit.cohort.capacity, converterUsdc6: 10_000_000_000n } } });
/** Test-made: the recorded converter's stored snapshot extended to be fresh at the read slot (valid_until @124). */
const freshSol = (m: Map<string, MimirBetaAccount | null>) => {
  const d = recorded.get(SOLFEED)!.data.slice(); new DataView(d.buffer).setBigUint64(124, slot + 100n, true);
  m.set(SOLFEED, { ...recorded.get(SOLFEED)!, data: d }); return m;
};

// Reads the preview adds: oracle, SOL converter, Clock; once the converter is read, its DLMM source pool and oracle.
assert.deepEqual(await planFitReads(JUP), [ORACLE, SOLFEED, CLOCK]);
const reads2 = await planFitReads(JUP, recorded);
assert.equal(reads2.length, 5);
const [CPOOL, CORACLE] = reads2.slice(2, 4) as string[] as [string, string];
assert.deepEqual([reads2[0], reads2[1], reads2[4]], [ORACLE, SOLFEED, CLOCK]);

// P11: DLMM row confidence = bin step 80 on the C8Gr6 bytes.
assert.equal(mimirBetaSourceQualityFloorBps("meteora-dlmm", recorded.get(fx.pool)!.data).confidenceBps, 80, "P11");

// P1 / J1′: as recorded, variant "new" → not as is, approval needed. The recorded converter expired at slot 460423333 (read at
// 462887589) and its sources were not in that read: its fresh price is not proved (MISSING_CONVERTER), so no bound either.
const p1 = await run(JUP);
assert.equal(p1.verdict.status, "not-as-is", "P1");
assert.ok(p1.verdict.failures.includes("FEED_OI_UNADMITTED"), "P1 approval");
assert.equal(p1.verdict.profile.name, "lending-standard-volatile");
const stale = p1.verdict.failures.includes("HISTORY_NOT_READY");
// The SOL converter cap (F/10 of the converter publication's floor) is not projected: MISSING_CAPACITY. The FeedOI headroom (primary
// and conversion) is not read: MISSING_OI (lib.rs:1694-1760).
if (stale) assert.deepEqual([p1.verdict.failures, p1.verdict.missing], [["FEED_OI_UNADMITTED", "HISTORY_NOT_READY", "PROOF_INVALID"],
  ["MISSING_CONVERTER", "MISSING_OI", "MISSING_BOUNDS", "MISSING_CAPACITY"]], "P1 stale");
else assert.deepEqual([p1.verdict.failures, p1.verdict.missing], [["FEED_OI_UNADMITTED"], ["MISSING_CONVERTER", "MISSING_OI", "MISSING_BOUNDS", "MISSING_CAPACITY"]], "J1′ approval");

// P2: the pool traded steadily (test-made copy of the recorded oracle: its last 5 records 60 s apart at the active bin, Clock = last + 10 s),
// spot on the window mean, variant 0. The converter is refreshed in the trade transaction (skew ≤ 2, mixed_bounded.rs:426), so its bound
// is its source's: a test-made converter pool (the C8Gr6 bytes with the converter source's sealed SOL/USDC mints and vaults, bound to its
// oracle PDA) on the steady oracle → 80. Ready at 161 = 80 ⊕ 80 once the converter cap is known; stable (100) fails CONFIDENCE.
const oracle = recorded.get(ORACLE)!.data, pair = recorded.get(fx.pool)!.data;
const pv = new DataView(pair.buffer, pair.byteOffset, pair.byteLength), activeBin = pv.getInt32(76, true), step = pv.getUint16(80, true);
const now = BigInt(new DataView(recorded.get(CLOCK)!.data.buffer, recorded.get(CLOCK)!.data.byteOffset).getBigInt64(32, true));
const steady = (() => {
  const o = oracle.slice(), v = new DataView(o.buffer), latest = v.getBigUint64(8, true), size = v.getBigUint64(16, true);
  const L = now - 10n;
  for (let d = 0n; d < 5n; d++) {
    const at = 32 + Number((latest - d + size) % size) * 32, cum = BigInt.asUintN(128, BigInt(activeBin) * (L - 60n * d));
    v.setBigUint64(at, cum & ((1n << 64n) - 1n), true); v.setBigUint64(at + 8, cum >> 64n, true);
    v.setBigUint64(at + 16, L - 60n * d - 30n, true); v.setBigUint64(at + 24, L - 60n * d, true);
  }
  return o;
})();
const sample = extractMeteoraDlmmNativeTwapSample({ oracleData: steady, currentTimestamp: now });
const meanBin = Number((sample.newCumulativeBin - sample.oldCumulativeBin) / (sample.newTimestamp - sample.oldTimestamp));
assert.equal(meanBin, activeBin);
const cs = decodeV1ClassicFeed(recorded.get(SOLFEED)!.data, SOLFEED as never).rows[0]!.source;
/** The converter's source pool (sealed mints/vaults) and oracle, on `oracleBytes`. */
const converterSource = (m: Map<string, MimirBetaAccount | null>, oracleBytes: Uint8Array) => {
  const cp = pair.slice(); cp.set(addressBytes(CORACLE as never), 552);
  cp.set(cs.subarray(232, 264), 88); cp.set(cs.subarray(264, 296), 120); cp.set(cs.subarray(168, 200), 152); cp.set(cs.subarray(200, 232), 184);
  m.set(CPOOL, { ...recorded.get(fx.pool)!, address: CPOOL, data: cp } as MimirBetaAccount);
  m.set(CORACLE, { ...recorded.get(ORACLE)!, address: CORACLE, data: oracleBytes } as MimirBetaAccount);
  return m;
};
const withBin = (bin: number) => {
  const m = new Map(recorded);
  const p = pair.slice(); new DataView(p.buffer).setInt32(76, bin, true);
  m.set(fx.pool, { ...recorded.get(fx.pool)!, data: p }); m.set(ORACLE, { ...recorded.get(ORACLE)!, data: steady });
  return converterSource(freshSol(m), steady);
};
const live = withBin(meanBin);
const V0: PlanFitPlan = { ...JUP, variant: 0 };
const fit2 = await planFit({ ...V0, accounts: live, slot });
assert.deepEqual([marketFitForPlan(fit2).verdict.status, marketFitForPlan(fit2).verdict.missing], ["unknown", ["MISSING_CONVERTER", "MISSING_OI", "MISSING_CAPACITY"]],
  "P2 planFit alone: converter refresh condition, FeedOI headroom and converter cap not read");
// Round 3, finding 1: the converter cap alone was Ready on 84d40d65; its refresh's depth/vault condition is still unproved.
assert.deepEqual([withConverterCap(fit2).verdict.status, withConverterCap(fit2).verdict.missing], ["unknown", ["MISSING_CONVERTER", "MISSING_OI"]], "P2 cap only");
assert.deepEqual(marketFitForPlan(evidence(fit2, false)).verdict.missing, ["MISSING_CAPACITY"], "P2 converter cap");
const p2 = withEvidence(fit2);
assert.deepEqual([p2.verdict.status, p2.verdict.reason, p2.verdict.limits.confBps, p2.verdict.profile.collateral], ["ready", "READY_PROJECTED", composeConfBps(80, 80), "volatile"], "P2");
assert.equal(p2.other.reason, "CONFIDENCE", "P2 other (stable)");

// J1′ when the pool traded steadily: approval is the only failure; the converter cap is the only gap.
const j1 = await run(JUP, live);
assert.deepEqual([j1.verdict.status, j1.verdict.failures, j1.verdict.missing], ["not-as-is", ["FEED_OI_UNADMITTED"], ["MISSING_CONVERTER", "MISSING_OI", "MISSING_CAPACITY"]], "J1′ approval");
assert.deepEqual(withEvidence(await planFit({ ...JUP, accounts: live, slot })).verdict.failures, ["FEED_OI_UNADMITTED"], "J1′ approval only");

// J2: the governed variant is Ready once the market admits any variant (data flip).
const any = { ...MARKET_RULES, feedOi: { permissionless: "any" as const } };
assert.equal(withEvidence(await planFit({ ...JUP, accounts: live, slot, rules: any })).verdict.status, "ready", "J2");

// P3: spot > 50 bps off the mean → the lag envelope widens the row.
const mean = meteoraDlmmPriceFromCumulativeBinX64(sample.newCumulativeBin - sample.oldCumulativeBin, sample.newTimestamp - sample.oldTimestamp, step);
const off = meanBin + 3;
const c = mimirNativeLagEnvelope(mean, meteoraDlmmPriceFromIdX64(off, step), step, 0xffff)!.confidenceBps;
const p3 = withEvidence(await planFit({ ...V0, accounts: withBin(off), slot }));
assert.ok(c > 80);
assert.equal(p3.verdict.status, composeConfBps(c, 80) <= 300 ? "ready" : "not-as-is", "P3 volatile");
assert.equal(p3.other.failures.includes("CONFIDENCE"), composeConfBps(c, 80) > 100, "P3 stable");

// P4: oracle not read → history and bounds missing.
const noOracle = withBin(meanBin); noOracle.delete(ORACLE);
const p4 = await run(JUP, noOracle);
assert.equal(p4.verdict.status, "not-as-is");
assert.ok(p4.verdict.failures.includes("FEED_OI_UNADMITTED") && ["MISSING_HISTORY", "MISSING_BOUNDS"].every((m) => p4.verdict.missing.includes(m as never)), "P4");
const p4v0 = await runE(V0, noOracle);
assert.deepEqual([p4v0.verdict.status, p4v0.verdict.reason], ["unknown", "MISSING_HISTORY"], "P4 v0");

// P5: converter known absent → CONVERTER_REQUIRED; read failed → MISSING_CONVERTER.
const noSol = new Map<string, MimirBetaAccount | null>(live); noSol.set(SOLFEED, null);
assert.deepEqual([(await run(V0, noSol)).verdict.status, (await run(V0, noSol)).verdict.reason], ["not-as-is", "CONVERTER_REQUIRED"], "P5");
const failed = marketFitForPlan(await planFit({ ...V0, accounts: undefined, slot }));
assert.equal(failed.verdict.status, "unknown");
assert.ok(failed.verdict.missing.includes("MISSING_CONVERTER"), "P5 read failed");

// P6: one DLMM pool, Default spot.
assert.deepEqual((await run({ ...V0, recipes: [null] }, live)).verdict.reason, "RECIPE_UNSUPPORTED", "P6");

// P7: single native proof: the auto policy (coverage 8000, dispersion 100) gets the market's parent clamp.
const fit7 = await planFit({ ...V0, accounts: live, slot });
assert.deepEqual([fit7.intents.default.policy!.minCoverageBps, fit7.intents.default.policy!.maxDispersionBps], [9000, 50], "P7 clamp");
assert.ok(!p2.verdict.failures.includes("POLICY_INVALID"), "P7");

// P8: PumpSwap USDC point. Live budget min(3·D50, LP cap seed × min(kappa 1000, maxTraderOi 2000)) and market 10·D50, never F/10
// (mixed_bounded.rs:34-35). At the reference seed 2 the LP cap
// is 0.2 USDC < the 1 USDC trade: every point market is Not as is under the 2/1 reference (SPEC §3b), whatever its depth.
const PUMP = await made("pumpswap", 10);
const pump = (depth: bigint): PlanFitPlan => ({ pools: [{ ...PUMP.pool, minDepthTo50BpsNative: depth }], quote: "USDC", programId: HBYR, variant: 0 });
const p8a = await run(pump(55_555_556n), boundTo(PUMP)), p8b = await run(pump(222_222_223n), boundTo(PUMP));
assert.deepEqual([p8a.verdict.status, p8a.verdict.failures, p8a.verdict.missing, p8a.verdict.limits.positionCapUsdc6, p8a.verdict.limits.marketCapUsdc6],
  ["not-as-is", ["TRADE_CAPACITY"], ["MISSING_OI"], 200_000n, 555_555_560n], "P8 seed 2");
assert.deepEqual([p8b.verdict.status, p8b.verdict.reason, p8b.verdict.profile.collateral], ["not-as-is", "TRADE_CAPACITY", "stable"], "P8 any depth");
const fit8 = await planFit({ ...pump(55_555_556n), accounts: boundTo(PUMP), slot });
assert.deepEqual([fit8.intents.default.seedUsdc, fit8.intents.default.tradeUsdc, fit8.cohort.capacity], [2, 1, { d50Usdc6: 55_555_556n }], "P8 reference, live D50");
const seed10 = marketFit(fit8.definition, evidence(fit8).cohort, { ...fit8.intents.default, seedUsdc: 10 });
assert.deepEqual([seed10.status, seed10.limits.positionCapUsdc6], ["ready", 1_000_000n], "P8 seed 10: 3·D50 = 166.67, LP 1 → ready (not F/10 = 0.5)");
const tiny = marketFit(fit8.definition, { ...fit8.cohort, capacity: { d50Usdc6: 166_666n } }, { ...fit8.intents.default, seedUsdc: 10, tradeUsdc: 0.1 });
assert.deepEqual([tiny.reason, tiny.limits.activationDepthUsdc6], ["ACTIVATION_CAPACITY", 499_998n], "P8 activation clamps to 3·D50 = 0.499998 < 1");
// Null vs unread: a known-absent pool fails; an unread one is MISSING, never Ready.
const p8null = await run(pump(222_222_223n), new Map([[PUMP.pool.pool, null]]));
assert.ok(p8null.verdict.failures.includes("SOURCE_LIQUIDITY") && p8null.verdict.failures.includes("SOURCE_CONDITION"), "P8 known absent");
for (const acc of [undefined, new Map()]) {
  const v = marketFitForPlan(await planFit({ ...pump(222_222_223n), accounts: acc, slot })).verdict;
  assert.ok(v.status !== "ready" && v.missing.includes("MISSING_BINDING") && v.missing.includes("MISSING_PUBLICATION"), `P8 unread ${acc ? "map" : "read failed"}`);
}

// P9: two spot pools on two exchanges → aggregate bounds not projectable.
const CPMM = await made("raydium-cpmm", 20), DAMM = await made("meteora-damm-v2", 30);
const p9plan: PlanFitPlan = { pools: [CPMM.pool, DAMM.pool], quote: "USDC", programId: HBYR, variant: 0 };
const fit9 = await planFit({ ...p9plan, accounts: boundTo(CPMM, DAMM), slot });
const p9 = marketFitForPlan(evidence(fit9));
assert.deepEqual([p9.verdict.status, p9.verdict.missing, fit9.cohort.publication!.qualifiedSources, fit9.cohort.publication!.qualifiedVenues],
  ["unknown", ["MISSING_BOUNDS"], 2, 2], "P9");

// P10: CPMM quiet interval → history only after creation.
const p10plan: PlanFitPlan = { pools: [CPMM.pool], recipes: ["cpmm-quiet-interval-v2"], quote: "USDC", programId: HBYR, variant: 0 };
const fit10 = await planFit({ ...p10plan, accounts: boundTo(CPMM), slot });
const p10 = marketFitForPlan(evidence(fit10));
assert.deepEqual([fit10.definition.rows[0]!.mode, fit10.definition.rows[0]!.temporalKind, fit10.cohort.history], [3, 1, { afterCreation: true }]);
assert.deepEqual([p10.verdict.status, p10.verdict.reason], ["unknown", "MISSING_HISTORY"], "P10");

// P12: converter freshness. The converter is refreshed in the trade transaction from its own DLMM source, whatever its stored price:
// ready sources → fresh, bound = max(bin step, envelope) = 80; a stale oracle → EXPIRED; sources not read → MISSING_CONVERTER.
const conv = (oracleBytes: Uint8Array) => { const m = withBin(meanBin); m.set(SOLFEED, recorded.get(SOLFEED)!); return converterSource(m, oracleBytes); };
const p12 = withEvidence(await planFit({ ...V0, accounts: conv(steady), slot }));
assert.deepEqual([p12.verdict.status, p12.verdict.limits.confBps, p12.other.reason], ["ready", composeConfBps(80, 80), "CONFIDENCE"], "P12 projected converter");
const p12x = await run(V0, conv(oracle));
assert.deepEqual([p12x.verdict.status, p12x.verdict.reason], ["not-as-is", "EXPIRED"], "P12 converter expired, refresh not ready");
const unproved = withBin(meanBin); unproved.set(SOLFEED, recorded.get(SOLFEED)!); unproved.delete(CPOOL); unproved.delete(CORACLE);
assert.deepEqual([(await run(V0, unproved)).verdict.status, (await run(V0, unproved)).verdict.reason], ["unknown", "MISSING_CONVERTER"], "P12 not proved");

// P13: the plan carries its rules; layout versions are compared, not only lengths.
const noPoint = { ...MARKET_RULES, revision: "reject-point", recipes: MARKET_RULES.recipes.filter((r) => r.mode !== 5) };
const p13 = marketFitForPlan(await planFit({ ...pump(222_222_223n), accounts: boundTo(PUMP), slot, rules: noPoint }));
assert.deepEqual([p13.verdict.reason, p13.verdict.rules], ["RECIPE_UNSUPPORTED", "reject-point"], "P13 rules bound to the plan");
const v1 = { ...MARKET_RULES, layout: { ...MARKET_RULES.layout, snapshotVersion: 1 } };
const p13l = await planFit({ ...pump(222_222_223n), accounts: boundTo(PUMP), slot, rules: v1 });
assert.deepEqual([p13l.cohort.target!.layout, marketFitForPlan(p13l).verdict.reason], [false, "LAYOUT_VERSION"], "P13 layout version");

// Counterexamples (each was Ready before the fix).
const never = (v: { status: string }, label: string) => assert.notEqual(v.status, "ready", label);
// 1. Pool authentication: a present account that is not the planned pool fails; unread or unauthenticatable is missing.
const badDisc = withBin(meanBin); { const d = badDisc.get(fx.pool)!.data.slice(); d[0]! ^= 1; badDisc.set(fx.pool, { ...badDisc.get(fx.pool)!, data: d }); }
const q1 = withEvidence(await planFit({ ...V0, accounts: badDisc, slot }));
assert.ok(q1.verdict.failures.includes("SOURCE_CONDITION"), "primary bad discriminator");
const wrongPair = withBin(meanBin); wrongPair.set(CPOOL, { ...wrongPair.get(CPOOL)!, data: (() => { const d = pair.slice(); d.set(addressBytes(CORACLE as never), 552); return d; })() });
assert.equal(withConverterCap(await planFit({ ...V0, accounts: wrongPair, slot })).verdict.reason, "CONVERTER_INVALID", "converter pool JUP/SOL, sealed SOL/USDC");
for (const [label, edit] of [["vault", (d: Uint8Array) => d.set(addressBytes(filled(99)), 139)], ["discriminator", (d: Uint8Array) => { d[0]! ^= 1; }]] as const) {
  const d = PUMP.account.data.slice(); edit(d);
  const v = (await run(pump(55_555_556n), boundTo({ account: { ...PUMP.account, data: d } }))).verdict;
  assert.ok(v.failures.includes("SOURCE_CONDITION"), `pumpswap ${label}`);
}
const wrongOwner = (await run(pump(55_555_556n), boundTo({ account: { ...PUMP.account, owner: fx.programId } }))).verdict;
assert.ok(wrongOwner.failures.includes("SOURCE_CONDITION"), "pumpswap owner");
const noClock = boundTo(PUMP); noClock.delete(CLOCK);
assert.ok((await run(pump(55_555_556n), noClock)).verdict.missing.includes("MISSING_BINDING"), "no clock: not authenticated");
// 2. A fresh stored converter price does not prove the in-transaction refresh: a known stale source fails, unread sources are missing.
never(withConverterCap(await planFit({ ...V0, accounts: converterSource(withBin(meanBin), oracle), slot })).verdict, "fresh stored, stale source");
assert.equal(withConverterCap(await planFit({ ...V0, accounts: converterSource(withBin(meanBin), oracle), slot })).verdict.reason, "EXPIRED");
const storedOnly = withBin(meanBin); storedOnly.delete(CPOOL); storedOnly.delete(CORACLE);
assert.equal(withConverterCap(await planFit({ ...V0, accounts: storedOnly, slot })).verdict.reason, "MISSING_CONVERTER", "fresh stored, sources unread");
// 9. A converter source known absent fails, its sibling read or not (round 3, 4b).
for (const k of [CPOOL, CORACLE]) {
  const m = withBin(meanBin); m.set(k, null);
  assert.equal(withEvidence(await planFit({ ...V0, accounts: m, slot })).verdict.reason, "CONVERTER_INVALID", `converter source ${k} null`);
  m.delete(k === CPOOL ? CORACLE : CPOOL);
  assert.equal(withEvidence(await planFit({ ...V0, accounts: m, slot })).verdict.reason, "CONVERTER_INVALID", `converter source ${k} null, sibling unread`);
}
// Round 3, finding 1: a projected-fresh converter whose refresh condition is unread is MISSING; a known nonzero condition fails.
const fresh1 = await planFit({ ...V0, accounts: live, slot });
assert.equal(fresh1.cohort.converter!.condition, undefined, "planFit reads no bin arrays or vaults");
const cond = (c: number | null) => marketFitForPlan({ ...evidence(fresh1), cohort: { ...evidence(fresh1).cohort, converter: { ...fresh1.cohort.converter!, condition: c } } }).verdict.reason;
assert.deepEqual([cond(32), cond(null)], ["CONVERTER_INVALID", "CONVERTER_INVALID"], "converter refresh condition known bad");
// Round 3, finding 2: no FeedOI headroom → MISSING_OI; a known insufficient headroom (primary or conversion) fails OI_CAPACITY.
const oi = (o: object) => marketFitForPlan({ ...evidence(fresh1), cohort: { ...evidence(fresh1).cohort, capacity: { ...evidence(fresh1).cohort.capacity, ...o } } }).verdict;
assert.deepEqual([oi({ feedOiHeadroomUsdc6: undefined }).reason, oi({ conversionOiHeadroomUsdc6: undefined }).reason], ["MISSING_OI", "MISSING_OI"], "headroom unread");
assert.deepEqual([oi({ feedOiHeadroomUsdc6: 49_999_999n }).reason, oi({ conversionOiHeadroomUsdc6: 49_999_999n }).reason], ["OI_CAPACITY", "OI_CAPACITY"], "headroom < 50 USDC");
assert.equal(oi({ conversionOiHeadroomUsdc6: 50_000_000n }).status, "ready", "headroom = trade");

console.log(`planFit: P1–P13, J1′${stale ? " (stale oracle at record)" : ""}, J2 ok`);
